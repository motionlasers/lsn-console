import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';
import { _electron as electron } from 'playwright-core';

const executablePath = process.env.LSN_WINDOWS_EXECUTABLE;
const evidenceDir = process.env.LSN_WINDOWS_SMOKE_EVIDENCE;
const certificatePath = process.env.LSN_WINDOWS_SMOKE_CERT;
const privateKeyPath = process.env.LSN_WINDOWS_SMOKE_KEY;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function phase(message) {
  console.log(`[profile-update-smoke] ${message}`);
}

async function closeElectronApp(electronApp) {
  const appProcess = electronApp.process();
  const closed = await Promise.race([
    electronApp.close().then(() => true, () => false),
    sleep(15_000, false, { ref: false }),
  ]);
  if (!closed && appProcess && !appProcess.killed) {
    phase('Electron did not close within 15 seconds; terminating it');
    appProcess.kill('SIGKILL');
  }
}

async function closeServer(server) {
  await Promise.race([
    new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    }),
    sleep(5_000, undefined, { ref: false }),
  ]);
}

function makePublishedProfile() {
  const readField = (symbolicName, attribute) => ({
    symbolicName,
    direction: 'LSN_TO_PC',
    dataType: 'boolean',
    access: 'READ',
    cipService: 'GetAttributeSingle',
    class: 150,
    instance: 7,
    attribute,
    assembly: null,
    wireType: 'bool8',
    implementationStatus: 'VERIFIED',
    simulationStatus: 'VERIFIED',
    expectedFirmwareBehavior: 'Artificial Windows CI mapping behavior.',
    expectedReportedResponse: 'Artificial Windows CI mapping response.',
  });
  return {
    profileVersion: '0.2.0',
    protocolVersion: 'LSN v0.1',
    displayName: 'Windows profile-only publication proof',
    hardwareFamily: 'WT32-ETH01',
    supportedFirmware: ['0.1.x', '0.2.x-development'],
    identity: {
      vendorId: 777,
      deviceType: 12,
      productCode: 52,
      mappingState: 'VERIFIED',
    },
    capabilities: {
      interlock: { enabled: false, phase: 'future', description: 'Disabled in Phase 1.' },
      remoteStop: { enabled: false, phase: 'future', description: 'Disabled in Phase 1.' },
      sensors: { enabled: false, phase: 'future', description: 'Disabled in Phase 1.' },
    },
    fields: [
      readField('Ready', 42),
      readField('Faulted', 43),
      readField('EmissionControlOutputActive', 44),
      { ...readField('InterlockOK', 45), capability: 'interlock' },
      { ...readField('RemoteStopOK', 46), capability: 'remoteStop' },
      {
        ...readField('EmissionEnableRequest', 47),
        direction: 'PC_TO_LSN',
        access: 'WRITE',
        cipService: 'SetAttributeSingle',
      },
    ],
  };
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function executableIdentity(runtime) {
  const bytes = await fs.readFile(executablePath);
  const stat = await fs.stat(executablePath);
  return {
    appVersion: runtime.appVersion,
    sha256: sha256(bytes),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

async function reloadDownloads(window) {
  await window.reload({ waitUntil: 'domcontentloaded' });
  await window.evaluate(() => { window.location.hash = '#/downloads'; });
  const card = window.getByTestId('desktop-profile-update-state');
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  return card;
}

async function main() {
  phase('starting installed profile update proof');
  if (process.platform !== 'win32') {
    throw new Error('Installed profile update smoke test must run on Windows');
  }
  if (!executablePath || !evidenceDir || !certificatePath || !privateKeyPath) {
    throw new Error('Executable, evidence directory, certificate, and key are required');
  }

  await fs.mkdir(evidenceDir, { recursive: true });
  const profile = makePublishedProfile();
  const artifactRaw = JSON.stringify(profile);
  const corruptArtifactRaw = JSON.stringify({
    ...profile,
    fields: profile.fields.map((field, index) =>
      index === 0 ? { ...field, attribute: 99 } : field),
  });
  const digest = sha256(Buffer.from(artifactRaw, 'utf8'));
  let published = false;
  let serveCorruptArtifact = false;
  const requests = [];
  const server = https.createServer({
    cert: await fs.readFile(certificatePath),
    key: await fs.readFile(privateKeyPath),
  }, (request, response) => {
    const url = new URL(request.url, 'https://localhost');
    requests.push({ method: request.method, path: url.pathname });
    if (url.pathname === '/api/auth/session') {
      return json(response, 200, {
        userId: 52,
        username: 'windows-ci',
        role: 'SUPERADMIN',
        permissions: ['profile:read'],
        isAdmin: true,
        forcePasswordChange: false,
      });
    }
    if (url.pathname === '/api/profiles') return json(response, 200, []);
    if (url.pathname === '/api/desktop/profile-channel') {
      return json(response, 200, published ? {
        available: true,
        profileVersion: profile.profileVersion,
        digest,
        artifactPath: `/api/desktop/profile-artifact/${profile.profileVersion}`,
        releaseName: 'Windows CI profile-only publication',
      } : { available: false });
    }
    if (url.pathname === `/api/desktop/profile-artifact/${profile.profileVersion}`) {
      const responseBody = serveCorruptArtifact ? corruptArtifactRaw : artifactRaw;
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(responseBody),
      });
      return response.end(responseBody);
    }
    return json(response, 404, { error: 'Not found' });
  });

  phase('starting mock publication server');
  await Promise.race([
    new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once('error', onError);
      server.listen(0, 'localhost', () => {
        server.off('error', onError);
        resolve();
      });
    }),
    sleep(15_000, undefined, { ref: false }).then(() => {
      throw new Error('Timed out starting the mock publication server on localhost');
    }),
  ]);
  const address = server.address();
  const apiOrigin = `https://localhost:${address.port}`;
  const userDataDir = path.join(evidenceDir, 'profile-smoke-user-data');
  phase('mock publication server listening');
  const electronApp = await electron.launch({
    executablePath,
    args: ['--disable-gpu', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      LSN_API_BASE_URL: apiOrigin,
      LSN_WINDOWS_PROFILE_SMOKE: '1',
      NODE_EXTRA_CA_CERTS: certificatePath,
    },
    timeout: 60_000,
  });
  phase('installed Electron application launched');

  try {
    const window = await electronApp.firstWindow({ timeout: 60_000 });
    await window.waitForLoadState('domcontentloaded');
    await window.evaluate(() => { window.location.hash = '#/downloads'; });
    let card = window.getByTestId('desktop-profile-update-state');
    await card.waitFor({ state: 'visible', timeout: 60_000 });
    phase('profile update card is visible');

    const runtimeBefore = await window.evaluate(() => window.lsnDesktop.getPlatform());
    const executableBefore = await executableIdentity(runtimeBefore);
    const processIdBefore = electronApp.process().pid;

    const unpublishedState = await window.evaluate(() =>
      window.lsnDesktop.checkForProfileUpdate());
    if (unpublishedState.error?.code !== 'no_update' || unpublishedState.staged) {
      throw new Error(`Unpublished profile channel was not empty: ${JSON.stringify(unpublishedState)}`);
    }
    phase('unpublished channel state confirmed');
    published = true;
    serveCorruptArtifact = true;
    const rejectedState = await window.evaluate(() =>
      window.lsnDesktop.checkForProfileUpdate());
    if (rejectedState.error?.code !== 'digest_mismatch' || rejectedState.staged) {
      throw new Error(`Corrupt profile was not rejected: ${JSON.stringify(rejectedState)}`);
    }
    if (rejectedState.active?.source !== 'bundled') {
      throw new Error(`Corrupt profile changed active state: ${JSON.stringify(rejectedState)}`);
    }
    phase('corrupt profile rejected without staging or activation');

    serveCorruptArtifact = false;
    const stagedState = await window.evaluate(() =>
      window.lsnDesktop.checkForProfileUpdate());
    const readyDiff = stagedState.mappingDiff?.find(
      (field) => field.symbolicName === 'Ready',
    );
    const attributeDiff = readyDiff?.changes?.find(
      (change) => change.property === 'attribute',
    );
    if (
      stagedState.staged?.digest !== digest ||
      readyDiff?.changeType !== 'changed' ||
      attributeDiff?.from !== 'UNRESOLVED' ||
      attributeDiff?.to !== '42'
    ) {
      throw new Error(`Staged mapping diff was incorrect: ${JSON.stringify(stagedState)}`);
    }
    card = await reloadDownloads(window);
    phase('published profile detected');
    phase('mapping diff verified');
    await card.screenshot({
      path: path.join(evidenceDir, 'profile-update-detected.png'),
    });

    const appliedState = await window.evaluate(async () => {
      const state = await window.lsnDesktop.getProfileChannelState();
      return window.lsnDesktop.activateProfileUpdate(state.staged?.digest);
    });
    if (appliedState.active?.profileVersion !== profile.profileVersion) {
      throw new Error(`Published profile activation failed: ${JSON.stringify(appliedState)}`);
    }
    const runtimeProfile = await window.evaluate(() =>
      window.lsnDesktop.hardwareGetProfileReadiness());
    const readyMapping = runtimeProfile.mappingEvidence.find(
      (field) => field.symbolicName === 'Ready',
    );
    if (
      appliedState.active?.profileVersion !== profile.profileVersion ||
      appliedState.active?.digest !== digest ||
      runtimeProfile.profileVersion !== profile.profileVersion ||
      runtimeProfile.profileDigest !== digest ||
      readyMapping?.class !== 150 ||
      readyMapping?.instance !== 7 ||
      readyMapping?.attribute !== 42
    ) {
      throw new Error(`Runtime did not repin published mapping: ${JSON.stringify({
        appliedState,
        runtimeProfile,
      })}`);
    }
    phase('published mapping applied to runtime');
    card = await reloadDownloads(window);
    await card.screenshot({ path: path.join(evidenceDir, 'profile-update-applied.png') });

    const runtimeAfter = await window.evaluate(() => window.lsnDesktop.getPlatform());
    const executableAfter = await executableIdentity(runtimeAfter);
    const processIdAfter = electronApp.process().pid;
    if (
      JSON.stringify(executableBefore) !== JSON.stringify(executableAfter) ||
      processIdBefore !== processIdAfter
    ) {
      throw new Error('Profile publication changed or restarted the installed executable');
    }

    const rolledBackState = await window.evaluate(() =>
      window.lsnDesktop.rollbackProfile(false));
    if (rolledBackState.active?.source !== 'bundled') {
      throw new Error(`Last-known-good rollback failed: ${JSON.stringify(rolledBackState)}`);
    }
    const audit = rolledBackState.audit;
    if (
      !audit.some((event) => event.event === 'PROFILE_APPLIED') ||
      !audit.some((event) => event.event === 'PROFILE_ROLLED_BACK') ||
      audit.some((event) => event.digest)
    ) {
      throw new Error(`Expected redacted apply and rollback audit evidence: ${JSON.stringify(audit)}`);
    }
    phase('bundled profile rollback and audit verified');
    card = await reloadDownloads(window);
    await card.screenshot({ path: path.join(evidenceDir, 'profile-update-rolled-back.png') });

    const evidence = {
      proof: 'profile-only-publication-on-unchanged-installed-windows-executable',
      apiOrigin: 'https://localhost:<ephemeral>',
      executableBefore,
      executableAfter,
      sameExecutableHash: executableBefore.sha256 === executableAfter.sha256,
      sameExecutableVersion: executableBefore.appVersion === executableAfter.appVersion,
      sameProcess: processIdBefore === processIdAfter,
      noRebuildOrReinstallTriggered: true,
      publishedProfile: {
        profileVersion: profile.profileVersion,
        digest,
        artificialMapping: readyMapping,
        mappingDiff: stagedState.mappingDiff,
      },
      runtimeProfile: {
        profileVersion: runtimeProfile.profileVersion,
        profileDigest: runtimeProfile.profileDigest,
        artificialMapping: readyMapping,
      },
      corruptProfileRejection: {
        rejected: true,
        code: rejectedState.error?.code,
        issues: rejectedState.error?.issues,
        activeSourceAfterRejection: rejectedState.active?.source,
        stagedAfterRejection: rejectedState.staged,
      },
      lastKnownGoodRollback: {
        succeeded: rolledBackState.active?.source === 'bundled',
        restoredSource: rolledBackState.active?.source,
        restoredProfileVersion: rolledBackState.active?.profileVersion,
      },
      redactedAudit: audit,
      installedAppBoundaryActions: [
        'window.lsnDesktop.checkForProfileUpdate',
        'window.lsnDesktop.activateProfileUpdate',
        'window.lsnDesktop.rollbackProfile',
      ],
      requests,
      screenshots: [
        'profile-update-detected.png',
        'profile-update-applied.png',
        'profile-update-rolled-back.png',
      ],
    };
    await fs.writeFile(
      path.join(evidenceDir, 'profile-only-publication-smoke.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    phase('evidence written');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await closeElectronApp(electronApp);
    await closeServer(server);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);