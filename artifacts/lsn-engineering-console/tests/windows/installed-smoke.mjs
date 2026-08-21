import fs from 'node:fs/promises';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';

const executablePath = process.env.LSN_WINDOWS_EXECUTABLE;
const evidenceDir = process.env.LSN_WINDOWS_SMOKE_EVIDENCE;
const runLabel = process.env.LSN_WINDOWS_SMOKE_LABEL || 'installed';

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Installed Windows smoke test must run on Windows');
  }
  if (!executablePath || !evidenceDir) {
    throw new Error('LSN_WINDOWS_EXECUTABLE and LSN_WINDOWS_SMOKE_EVIDENCE are required');
  }

  await fs.access(executablePath);
  await fs.mkdir(evidenceDir, { recursive: true });

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
    if (
      hardware.discoveryTransport !== true ||
      hardware.sessionTransport !== true ||
      hardware.profileControl !== false ||
      hardware.profileRead !== false ||
      hardware.maintenanceTransport !== 'MAINTENANCE ENDPOINT NOT YET IMPLEMENTED'
    ) {
      throw new Error(`Unexpected hardware boundaries: ${JSON.stringify(hardware)}`);
    }

    const updates = await window.evaluate(() => window.lsnDesktop.getUpdateState());
    if (updates.currentVersion !== runtime.appVersion || updates.status === 'unsupported') {
      throw new Error(`Unexpected update state: ${JSON.stringify(updates)}`);
    }

    const screenshot = path.join(evidenceDir, `${runLabel}-login.png`);
    await window.screenshot({ path: screenshot, fullPage: true });
    const evidence = {
      runLabel,
      executablePath,
      title,
      runtime,
      hardware: {
        discoveryTransport: hardware.discoveryTransport,
        sessionTransport: hardware.sessionTransport,
        profileControl: hardware.profileControl,
        profileRead: hardware.profileRead,
        maintenanceTransport: hardware.maintenanceTransport,
      },
      updates: {
        status: updates.status,
        currentVersion: updates.currentVersion,
      },
      checks: [
        'installed executable launched',
        'packaged preload bridge available',
        'login username/password/sign-in controls visible',
        'physical discovery/session limited to packaged Windows',
        'unresolved profile control/read fail closed',
        'maintenance transport remains unavailable',
        'Windows updater initialized',
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
  process.exitCode = 1;
});