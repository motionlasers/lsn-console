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

async function waitForProfileState(window, predicate, label) {
  const deadline = Date.now() + 30_000;
  do {
    const state = await window.evaluate(() => window.lsnDesktop.getProfileChannelState());
    if (predicate(state)) return state;
    await sleep(250);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
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
  const digest = sha256(Buffer.from(artifactRaw, 'utf8'));
  let published = false;
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
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(artifactRaw),
      });
      return response.end(artifactRaw);
    }
    return json(response, 404, { error: 'Not found' });
  });

  phase('starting mock publication server');
  await Promise.race([
    new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        resolve();
      });
    }),
    sleep(15_000, undefined, { ref: false }).then(() => {
      throw new Error('Timed out starting the mock publication server on 127.0.0.1');
    }),
  ]);
  const address = server.address();
  const apiOrigin = `https://127.0.0.1:${address.port}`;
  const userDataDir = path.join(evidenceDir, 'profile-smoke-user-data');
  phase('mock publication server listening');
  const electronApp = await electron.launch({
    executablePath,
    args: ['--disable-gpu', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, LSN_API_BASE_URL: apiOrigin },
    timeout: 60_000,
  });
  phase('installed Electron application launched');

  try {
    const window = await electronApp.firstWindow({ timeout: 60_000 });
    await window.waitForLoadState('domcontentloaded');
    await window.evaluate(() => { window.location.hash = '#/downloads'; });
    const card = window.getByTestId('desktop-profile-update-state');
    await card.waitFor({ state: 'visible', timeout: 60_000 });
    phase('profile update card is visible');

    const runtimeBefore = await window.evaluate(() => window.lsnDesktop.getPlatform());
    const executableBefore = await executableIdentity(runtimeBefore);
    const processIdBefore = electronApp.process().pid;

    await window.getByTestId('button-check-profile-update').click();
    await window.getByText('Staged update').waitFor();
    phase('unpublished channel state confirmed');
    published = true;
    await window.getByTestId('button-check-profile-update').click();

    const available = window.getByTestId('new-profile-available');
    await available.getByText('NEW PROFILE AVAILABLE').waitFor({ timeout: 30_000 });
    await available.getByText(`Profile version ${profile.profileVersion}`).waitFor();
    phase('published profile detected');
    await window.getByTestId('button-view-profile-changes').click();
    const mappingDiff = window.getByTestId('profile-mapping-diff');
    await mappingDiff.getByText('MAPPING DIFF').waitFor();
    await mappingDiff.getByText('Ready · CHANGED').waitFor();
    await mappingDiff.getByText(/attribute: UNRESOLVED → 42/).waitFor();
    phase('mapping diff verified');
    await card.screenshot({
      path: path.join(evidenceDir, 'profile-update-available-and-diff.png'),
    });

    await window.getByTestId('button-apply-profile-update').click();
    const appliedState = await waitForProfileState(
      window,
      (state) => state.active?.profileVersion === profile.profileVersion,
      'published profile activation',
    );
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

    await window.getByTestId('button-rollback-profile-update').click();
    const rolledBackState = await waitForProfileState(
      window,
      (state) => state.active?.source === 'bundled',
      'bundled profile rollback',
    );
    const audit = rolledBackState.audit;
    if (
      !audit.some((event) => event.event === 'PROFILE_APPLIED') ||
      !audit.some((event) => event.event === 'PROFILE_ROLLED_BACK') ||
      audit.some((event) => event.digest)
    ) {
      throw new Error(`Expected redacted apply and rollback audit evidence: ${JSON.stringify(audit)}`);
    }
    phase('bundled profile rollback and audit verified');
    await card.screenshot({ path: path.join(evidenceDir, 'profile-update-rolled-back.png') });

    const evidence = {
      proof: 'profile-only-publication-on-unchanged-installed-windows-executable',
      apiOrigin: 'https://127.0.0.1:<ephemeral>',
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
      },
      runtimeProfile: {
        profileVersion: runtimeProfile.profileVersion,
        profileDigest: runtimeProfile.profileDigest,
        artificialMapping: readyMapping,
      },
      redactedAudit: audit,
      requests,
      screenshots: [
        'profile-update-available-and-diff.png',
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