import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';

const executablePath = process.env.LSN_WINDOWS_EXECUTABLE;
const evidenceDir = process.env.LSN_WINDOWS_SMOKE_EVIDENCE;
const runLabel = process.env.LSN_WINDOWS_SMOKE_LABEL || 'installed';
const expectPhysicalTransport =
  process.env.LSN_WINDOWS_EXPECT_PHYSICAL_TRANSPORT !== 'false';
const expectUpdater = process.env.LSN_WINDOWS_EXPECT_UPDATER !== 'false';

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Installed Windows smoke test must run on Windows');
  }
  if (!executablePath || !evidenceDir) {
    throw new Error('LSN_WINDOWS_EXECUTABLE and LSN_WINDOWS_SMOKE_EVIDENCE are required');
  }

  await fs.access(executablePath);
  await fs.mkdir(evidenceDir, { recursive: true });
  const executableStat = await fs.stat(executablePath);
  const executableSha256 = await sha256File(executablePath);

  const electronApp = await electron.launch({
    executablePath,
    args: ['--disable-gpu'],
    timeout: 60_000,
  });

  try {
    const window = await electronApp.firstWindow({ timeout: 60_000 });
    await window.waitForLoadState('domcontentloaded');
    await window.locator('#lsn-username').waitFor({ state: 'visible', timeout: 60_000 });
    await window.locator('#lsn-password').waitFor({ state: 'visible' });
    await window.getByRole('button', { name: 'SIGN IN' }).waitFor({ state: 'visible' });

    const title = await window.title();
    if (!title.includes('LSN Engineering Console')) {
      throw new Error(`Unexpected window title: ${title}`);
    }

    const runtime = await window.evaluate(() => window.lsnDesktop.getPlatform());
    if (
      runtime.platform !== 'win32' ||
      runtime.packaged !== true ||
      typeof runtime.appVersion !== 'string'
    ) {
      throw new Error(`Unexpected packaged runtime: ${JSON.stringify(runtime)}`);
    }

    const hardware = await window.evaluate(() =>
      window.lsnDesktop.getHardwareCapabilities(),
    );
    const hardwareState = {
      discoveryTransport: hardware.discoveryTransport === true,
      sessionTransport: hardware.sessionTransport === true,
      profileControl: hardware.profileControl === true,
      profileRead: hardware.profileRead === true,
      maintenanceTransport: hardware.maintenanceTransport,
    };
    if (
      hardwareState.discoveryTransport !== expectPhysicalTransport ||
      hardwareState.sessionTransport !== expectPhysicalTransport ||
      hardwareState.profileControl !== false ||
      hardwareState.profileRead !== false ||
      hardwareState.maintenanceTransport !==
        'MAINTENANCE ENDPOINT NOT YET IMPLEMENTED'
    ) {
      throw new Error(`Unexpected hardware boundaries: ${JSON.stringify(hardware)}`);
    }

    const updates = await window.evaluate(() =>
      typeof window.lsnDesktop.getUpdateState === 'function'
        ? window.lsnDesktop.getUpdateState()
        : null,
    );
    if (
      expectUpdater &&
      (!updates ||
        updates.currentVersion !== runtime.appVersion ||
        updates.status === 'unsupported')
    ) {
      throw new Error(`Unexpected update state: ${JSON.stringify(updates)}`);
    }
    if (!expectUpdater && updates) {
      throw new Error(
        `Historical release unexpectedly exposed updater: ${JSON.stringify(updates)}`,
      );
    }

    const screenshot = path.join(evidenceDir, `${runLabel}-login.png`);
    await window.screenshot({ path: screenshot, fullPage: true });
    const evidence = {
      runLabel,
      executablePath,
      executableIdentity: {
        appVersion: runtime.appVersion,
        sha256: executableSha256,
        size: executableStat.size,
        modifiedAt: executableStat.mtime.toISOString(),
      },
      title,
      runtime,
      hardware: hardwareState,
      expectedPhysicalTransport: expectPhysicalTransport,
      expectedUpdater: expectUpdater,
      updates: updates
        ? {
            status: updates.status,
            currentVersion: updates.currentVersion,
          }
        : null,
      checks: [
        'installed executable launched',
        'packaged preload bridge available',
        'login username/password/sign-in controls visible',
        'physical discovery/session limited to packaged Windows',
        'unresolved profile control/read fail closed',
        'maintenance transport remains unavailable',
        expectUpdater
          ? 'Windows updater initialized'
          : 'historical release recorded without updater bridge',
      ],
    };
    await fs.writeFile(
      path.join(evidenceDir, `${runLabel}-smoke.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});