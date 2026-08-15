const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const RELEASE_API_URL =
  'https://api.github.com/repos/motionlasers/lsn-console/releases/latest';
const RELEASE_DOWNLOAD_PREFIX =
  'https://github.com/motionlasers/lsn-console/releases/download/';
const CHECKSUM_ASSET_NAME = 'SHA256SUMS.txt';
const MAX_INSTALLER_BYTES = 500 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_RELEASE_METADATA_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

function parseStableVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareStableVersions(left, right) {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  if (!a || !b) throw new Error('Invalid stable semantic version');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function installerNameForVersion(version) {
  return `LSN-Engineering-Console-Setup-${version}-dev.exe`;
}

function checksumUrlForVersion(version) {
  return `${RELEASE_DOWNLOAD_PREFIX}lsn-console-v${version}/${CHECKSUM_ASSET_NAME}`;
}

function validateReleaseAssetUrl(url, tag, filename) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const expected = new URL(
      `${RELEASE_DOWNLOAD_PREFIX}${tag}/${filename}`,
    );
    return parsed.protocol === 'https:' && parsed.href === expected.href;
  } catch {
    return false;
  }
}

function selectNewerStableRelease(release, currentVersion) {
  if (!release || release.draft === true || release.prerelease === true) return null;
  const tag = release.tag_name;
  if (typeof tag !== 'string' || !tag.startsWith('lsn-console-v')) return null;
  const version = tag.slice('lsn-console-v'.length);
  if (!parseStableVersion(version)) return null;
  if (compareStableVersions(version, currentVersion) <= 0) return null;

  const installerName = installerNameForVersion(version);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installer = assets.find((asset) => asset?.name === installerName);
  const checksum = assets.find((asset) => asset?.name === CHECKSUM_ASSET_NAME);
  if (
    !installer ||
    !checksum ||
    !validateReleaseAssetUrl(installer.browser_download_url, tag, installerName) ||
    !validateReleaseAssetUrl(
      checksum.browser_download_url,
      tag,
      CHECKSUM_ASSET_NAME,
    )
  ) {
    throw new Error('Latest release is missing required update assets');
  }

  return {
    version,
    tag,
    releaseName:
      typeof release.name === 'string' && release.name.trim()
        ? release.name.trim()
        : tag,
    installerName,
    installerUrl: installer.browser_download_url,
    checksumUrl: checksum.browser_download_url,
  };
}

function parseChecksumManifest(manifest, filename) {
  if (typeof manifest !== 'string') throw new Error('Invalid checksum manifest');
  for (const line of manifest.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+[*]?(.+)$/.exec(line.trim());
    if (match && match[2] === filename) return match[1].toLowerCase();
  }
  throw new Error(`Checksum not found for ${filename}`);
}

function publicState(state) {
  return {
    status: state.status,
    currentVersion: state.currentVersion,
    latestVersion: state.latestVersion,
    releaseName: state.releaseName,
    receivedBytes: state.receivedBytes,
    totalBytes: state.totalBytes,
    percent: state.percent,
    message: state.message,
    errorCode: state.errorCode,
    canRetry: state.canRetry,
    checkedAt: state.checkedAt,
    installerTrust: state.installerTrust,
  };
}

function classifyPublisherSignature(signature, expectedPublisher) {
  if (signature?.Status === 'NotSigned') return 'unsigned';
  if (
    signature?.Status === 'Valid' &&
    typeof signature.Publisher === 'string' &&
    typeof expectedPublisher === 'string' &&
    expectedPublisher.length > 0
  ) {
    return signature.Publisher.trim().toLowerCase() ===
      expectedPublisher.trim().toLowerCase()
      ? 'trusted-publisher'
      : 'unexpected-publisher';
  }
  return 'invalid';
}

function isTrustedPublisherSignature(signature, expectedPublisher) {
  return (
    classifyPublisherSignature(signature, expectedPublisher) ===
    'trusted-publisher'
  );
}

function isInstallableTrust(trust) {
  return trust === 'trusted-publisher' || trust === 'unsigned';
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const file = await fs.open(filePath, 'r');
  try {
    for await (const chunk of file.createReadStream()) hash.update(chunk);
  } finally {
    await file.close().catch(() => {});
  }
  return hash.digest('hex');
}

class WindowsUpdateService {
  constructor(options) {
    this.currentVersion = options.currentVersion;
    this.supported = options.supported;
    this.fetch = options.fetch;
    this.updatesDir = options.updatesDir;
    this.inspectSignature = options.inspectSignature;
    this.confirmInstall = options.confirmInstall;
    this.launchInstaller = options.launchInstaller;
    this.onStateChange = options.onStateChange ?? (() => {});
    this.now = options.now ?? (() => new Date().toISOString());
    this.prepared = null;
    this.activeOperation = null;
    this.state = {
      status: this.supported ? 'idle' : 'unsupported',
      currentVersion: this.currentVersion,
      message: this.supported
        ? 'Update check has not run yet.'
        : 'Automatic updates are available only in the packaged Windows app.',
      canRetry: this.supported,
    };
  }

  getState() {
    return publicState(this.state);
  }

  setState(patch) {
    this.state = {
      currentVersion: this.currentVersion,
      ...patch,
    };
    const snapshot = this.getState();
    this.onStateChange(snapshot);
    return snapshot;
  }

  async initialize() {
    if (!this.supported) return this.getState();
    await fs.mkdir(this.updatesDir, { recursive: true });
    await this.restorePreparedUpdate();
    return this.getState();
  }

  async restorePreparedUpdate() {
    const metadataPath = path.join(this.updatesDir, 'ready.json');
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      if (
        !metadata ||
        !parseStableVersion(metadata.version) ||
        compareStableVersions(metadata.version, this.currentVersion) <= 0 ||
        metadata.installerName !== installerNameForVersion(metadata.version) ||
        !/^[a-f0-9]{64}$/.test(metadata.sha256)
      ) {
        throw new Error('Invalid prepared update metadata');
      }
      const installerPath = path.join(this.updatesDir, metadata.installerName);
      const installerTrust = await this.inspectSignature(installerPath);
      if (
        (await sha256File(installerPath)) !== metadata.sha256 ||
        !isInstallableTrust(installerTrust)
      ) {
        throw new Error('Prepared update verification failed');
      }
      this.prepared = {
        version: metadata.version,
        releaseName: metadata.releaseName,
        installerName: metadata.installerName,
        installerPath,
        sha256: metadata.sha256,
        installerTrust,
      };
      this.setState({
        status: 'deferred',
        latestVersion: metadata.version,
        releaseName: metadata.releaseName,
        message: `Version ${metadata.version} is downloaded and ready to install.`,
        canRetry: true,
        installerTrust,
      });
    } catch {
      await this.removePreparedUpdate();
    }
  }

  async removePreparedUpdate() {
    this.prepared = null;
    await fs.rm(path.join(this.updatesDir, 'ready.json'), { force: true });
    const entries = await fs.readdir(this.updatesDir).catch(() => []);
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.endsWith('.download') ||
            /^LSN-Engineering-Console-Setup-.+-dev\.exe$/.test(entry),
        )
        .map((entry) =>
          fs.rm(path.join(this.updatesDir, entry), { force: true }),
        ),
    );
  }

  async check() {
    if (!this.supported) return this.getState();
    if (this.activeOperation) return this.activeOperation;
    this.activeOperation = this.runCheck().finally(() => {
      this.activeOperation = null;
    });
    return this.activeOperation;
  }

  async runCheck() {
    this.setState({
      status: 'checking',
      message: 'Checking for Windows Console updates…',
      canRetry: false,
    });
    try {
      const response = await this.fetchWithTimeout(RELEASE_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'LSN-Engineering-Console',
        },
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const release = JSON.parse(
        await this.readTextLimited(response, MAX_RELEASE_METADATA_BYTES),
      );
      const selected = selectNewerStableRelease(release, this.currentVersion);
      const checkedAt = this.now();
      if (!selected) {
        if (this.prepared) {
          return this.setState({
            status: 'deferred',
            latestVersion: this.prepared.version,
            releaseName: this.prepared.releaseName,
            message: `Version ${this.prepared.version} is downloaded and ready to install.`,
            canRetry: true,
            checkedAt,
          installerTrust: this.prepared.installerTrust,
          });
        }
        return this.setState({
          status: 'up-to-date',
          message: `Version ${this.currentVersion} is the latest available release.`,
          canRetry: true,
          checkedAt,
        });
      }

      if (this.prepared?.version === selected.version) {
        return this.setState({
          status: 'deferred',
          latestVersion: selected.version,
          releaseName: selected.releaseName,
          message: `Version ${selected.version} is downloaded and ready to install.`,
          canRetry: true,
          checkedAt,
          installerTrust: this.prepared.installerTrust,
        });
      }

      await this.removePreparedUpdate();
      return await this.downloadSelectedRelease(selected, checkedAt);
    } catch (error) {
      console.error('[desktop-updater] update check failed', error);
      if (this.prepared) {
        return this.setState({
          status: 'deferred',
          latestVersion: this.prepared.version,
          releaseName: this.prepared.releaseName,
          message: `Could not check for a newer release. Version ${this.prepared.version} remains ready to install.`,
          errorCode: 'UPDATE_CHECK_FAILED',
          canRetry: true,
        });
      }
      return this.setState({
        status: 'error',
        message:
          'Could not check for updates. The installed version is still available and unaffected.',
        errorCode: 'UPDATE_CHECK_FAILED',
        canRetry: true,
      });
    }
  }

  async downloadSelectedRelease(selected, checkedAt) {
    this.setState({
      status: 'downloading',
      latestVersion: selected.version,
      releaseName: selected.releaseName,
      receivedBytes: 0,
      message: `Downloading version ${selected.version}…`,
      canRetry: false,
      checkedAt,
    });

    try {
      const manifestResponse = await this.fetchWithTimeout(
        selected.checksumUrl,
      );
      if (!manifestResponse.ok) {
        throw new Error(`Checksum download returned ${manifestResponse.status}`);
      }
      const manifest = await this.readTextLimited(
        manifestResponse,
        MAX_MANIFEST_BYTES,
      );
      const expectedHash = parseChecksumManifest(
        manifest,
        selected.installerName,
      );
      const installerPath = path.join(
        this.updatesDir,
        selected.installerName,
      );
      const temporaryPath = `${installerPath}.download`;
      const actualHash = await this.downloadInstaller(
        selected,
        temporaryPath,
      );
      if (actualHash !== expectedHash) {
        throw new Error('Downloaded installer checksum did not match');
      }
      const installerTrust = await this.inspectSignature(temporaryPath);
      if (!isInstallableTrust(installerTrust)) {
        throw new Error(`Downloaded installer signature is ${installerTrust}`);
      }
      await fs.rename(temporaryPath, installerPath);
      const metadata = {
        version: selected.version,
        releaseName: selected.releaseName,
        installerName: selected.installerName,
        sha256: actualHash,
        installerTrust,
      };
      await fs.writeFile(
        path.join(this.updatesDir, 'ready.json'),
        JSON.stringify(metadata),
        { encoding: 'utf8', mode: 0o600 },
      );
      this.prepared = { ...metadata, installerPath };
      return this.setState({
        status: 'ready',
        latestVersion: selected.version,
        releaseName: selected.releaseName,
        message: `Version ${selected.version} is verified and ready to install.`,
        canRetry: true,
        checkedAt,
        installerTrust,
      });
    } catch (error) {
      console.error('[desktop-updater] update download failed', error);
      await this.removePreparedUpdate();
      return this.setState({
        status: 'error',
        latestVersion: selected.version,
        releaseName: selected.releaseName,
        message:
          'The update could not be downloaded or verified. You can keep using this version and retry later.',
        errorCode: 'UPDATE_DOWNLOAD_FAILED',
        canRetry: true,
        checkedAt,
      });
    }
  }

  async downloadInstaller(selected, temporaryPath) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let file;
    try {
      const response = await this.fetch(selected.installerUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LSN-Engineering-Console' },
      });
      if (!response.ok || !response.body) {
        throw new Error(`Installer download returned ${response.status}`);
      }
      const lengthHeader = response.headers.get('content-length');
      const totalBytes = lengthHeader ? Number(lengthHeader) : undefined;
      if (
        totalBytes !== undefined &&
        (!Number.isSafeInteger(totalBytes) ||
          totalBytes <= 0 ||
          totalBytes > MAX_INSTALLER_BYTES)
      ) {
        throw new Error('Installer size is invalid');
      }

      file = await fs.open(temporaryPath, 'w', 0o600);
      const reader = response.body.getReader();
      const hash = crypto.createHash('sha256');
      let receivedBytes = 0;
      let lastProgressAt = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_INSTALLER_BYTES) {
          throw new Error('Installer exceeds maximum allowed size');
        }
        hash.update(chunk);
        await file.write(chunk);
        const now = Date.now();
        if (now - lastProgressAt >= 100) {
          lastProgressAt = now;
          this.setState({
            status: 'downloading',
            latestVersion: selected.version,
            releaseName: selected.releaseName,
            receivedBytes,
            totalBytes,
            percent: totalBytes
              ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
              : undefined,
            message: `Downloading version ${selected.version}…`,
            canRetry: false,
          });
        }
      }
      if (receivedBytes === 0) throw new Error('Installer download was empty');
      if (totalBytes !== undefined && receivedBytes !== totalBytes) {
        throw new Error('Installer download was incomplete');
      }
      this.setState({
        status: 'downloading',
        latestVersion: selected.version,
        releaseName: selected.releaseName,
        receivedBytes,
        totalBytes,
        percent: totalBytes ? 100 : undefined,
        message: `Verifying version ${selected.version}…`,
        canRetry: false,
      });
      return hash.digest('hex');
    } finally {
      clearTimeout(timer);
      await file?.close().catch(() => {});
    }
  }

  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async readTextLimited(response, maximumBytes) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
      throw new Error('Response exceeded maximum allowed size');
    }
    return text;
  }

  async fetchPublishedInstallerHash(version, installerName) {
    if (
      !parseStableVersion(version) ||
      installerName !== installerNameForVersion(version)
    ) {
      throw new Error('Invalid prepared update identity');
    }
    const response = await this.fetchWithTimeout(
      checksumUrlForVersion(version),
    );
    if (!response.ok) {
      throw new Error(`Checksum revalidation returned ${response.status}`);
    }
    return parseChecksumManifest(
      await this.readTextLimited(response, MAX_MANIFEST_BYTES),
      installerName,
    );
  }

  defer() {
    if (this.state.status !== 'ready' || !this.prepared) return this.getState();
    return this.setState({
      status: 'deferred',
      latestVersion: this.prepared.version,
      releaseName: this.prepared.releaseName,
      message: `Version ${this.prepared.version} is ready whenever you choose to install it.`,
      canRetry: true,
      installerTrust: this.prepared.installerTrust,
    });
  }

  async install() {
    if (!this.prepared || !['ready', 'deferred'].includes(this.state.status)) {
      return this.getState();
    }
    if (this.activeOperation) return this.activeOperation;
    this.activeOperation = this.runInstall().finally(() => {
      this.activeOperation = null;
    });
    return this.activeOperation;
  }

  async runInstall() {
    const prepared = this.prepared;
    try {
      const actualHash = await sha256File(prepared.installerPath);
      const installerTrust = await this.inspectSignature(
        prepared.installerPath,
      );
      if (
        actualHash !== prepared.sha256 ||
        !isInstallableTrust(installerTrust) ||
        installerTrust !== prepared.installerTrust
      ) {
        throw new Error('Prepared installer verification failed');
      }
      if (
        installerTrust === 'unsigned' &&
        (await this.fetchPublishedInstallerHash(
          prepared.version,
          prepared.installerName,
        )) !== actualHash
      ) {
        throw new Error('Published installer checksum changed');
      }
      if (
        installerTrust === 'unsigned' &&
        !(await this.confirmInstall({
          version: prepared.version,
          releaseName: prepared.releaseName,
          installerTrust,
        }))
      ) {
        return this.setState({
          status: 'deferred',
          latestVersion: prepared.version,
          releaseName: prepared.releaseName,
          message: `Version ${prepared.version} remains ready to install.`,
          canRetry: true,
          installerTrust,
        });
      }
      this.setState({
        status: 'installing',
        latestVersion: prepared.version,
        releaseName: prepared.releaseName,
        message: `Starting the installer for version ${prepared.version}…`,
        canRetry: false,
        installerTrust,
      });
      await this.launchInstaller(prepared.installerPath);
      return this.getState();
    } catch (error) {
      console.error('[desktop-updater] installer launch failed', error);
      return this.setState({
        status: 'error',
        latestVersion: prepared.version,
        releaseName: prepared.releaseName,
        message:
          'The installer could not be started. This version is still running and the update can be retried.',
        errorCode: 'UPDATE_INSTALL_FAILED',
        canRetry: true,
      });
    }
  }
}

module.exports = {
  CHECKSUM_ASSET_NAME,
  RELEASE_API_URL,
  WindowsUpdateService,
  checksumUrlForVersion,
  classifyPublisherSignature,
  compareStableVersions,
  installerNameForVersion,
  isTrustedPublisherSignature,
  parseChecksumManifest,
  parseStableVersion,
  selectNewerStableRelease,
  sha256File,
  validateReleaseAssetUrl,
};