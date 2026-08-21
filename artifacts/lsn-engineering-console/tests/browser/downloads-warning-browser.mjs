/**
 * Browser regression check for the Downloads page TBD-mapping warning box.
 *
 * Boots the Vite dev server, drives real Chromium (playwright-core) and verifies:
 *  - the UNRESOLVED MAPPINGS DETECTED warning appears on /downloads for the
 *    default profile (which ships with cipService: "TBD" on every field)
 *  - all four resolution steps in the ordered list are visible
 *  - clicking "Go to Profile →" navigates to /profile
 *  - the warning disappears, including after reload, when every persisted
 *    profile field has a concrete CIP service, class, instance, and attribute
 *
 * Run: node tests/browser/downloads-warning-browser.mjs  (from the artifact directory)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ARTIFACT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXECUTABLE = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
let BASE = ''; // set once the dev server owns a freshly allocated port

function allocatePort() {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

const failures = [];
let checks = 0;
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  }
}

async function waitFor(fn, msg, timeout = 8000, interval = 50) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for: ${msg}`);
}

async function startServer() {
  // Allocate a fresh OS-assigned port so the test can never silently attach to a
  // stale or unrelated server. Vite runs with strictPort, so a rare TOCTOU
  // collision makes the child exit — which fails the run below — rather than
  // drifting to another port.
  const port = Number(process.env.DOWNLOADS_TEST_PORT ?? (await allocatePort()));
  BASE = `http://127.0.0.1:${port}`;
  const proc = spawn('pnpm', ['run', 'dev'], {
    cwd: ARTIFACT_DIR,
    env: { ...process.env, PORT: String(port), BASE_PATH: '/', REPL_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so the whole pnpm -> vite tree can be killed
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  let exited = null;
  proc.on('exit', (code, signal) => { exited = { code, signal }; });
  await waitFor(async () => {
    if (exited) throw new Error(`dev server exited before serving (code ${exited.code}, signal ${exited.signal}) — port ${port} may be in use by another process`);
    try {
      const res = await fetch(BASE + '/');
      // Require the response to be our Vite dev server (it injects /@vite/client),
      // never some unrelated process that happens to hold the port.
      return res.ok && (await res.text()).includes('/@vite/client');
    } catch {
      return false;
    }
  }, `our vite dev server to respond on port ${port}`, 60000, 250);
  console.log(`[downloads-warning-browser] dev server owned by test on port ${port} (pid ${proc.pid})`);
  return proc;
}

async function downloadsWarningChecks(context) {
  const label = 'downloads-warning';
  const page = await context.newPage();

  // Suppress the auto-started guided tour before the page loads. The tour
  // auto-starts when hasSeenTour=false and navigates away from the current
  // route on its first step (route: '/'). Seeding the tour preference via
  // addInitScript ensures it never activates in this fixture, keeping our
  // /profile navigation assertion deterministic.
  await page.addInitScript(() => {
    localStorage.setItem(
      'lsn-tour-preference-v1',
      JSON.stringify({
        state: { hasSeenTour: true, isTourActive: false, currentStep: 0 },
        version: 0,
      }),
    );
    localStorage.setItem('lsn-whats-new-acknowledged-version', '0.2.1');
    let updateState = {
      status: 'up-to-date',
      currentVersion: '0.2.1',
      message: 'Version 0.2.1 is the latest available release.',
      canRetry: true,
    };
    const updateListeners = new Set();
    const publishUpdateState = (next) => {
      updateState = next;
      for (const listener of updateListeners) listener(next);
    };
    window.lsnDesktop = {
      getPlatform: async () => ({
        platform: 'win32',
        packaged: true,
        appVersion: '0.2.1',
      }),
      authRequest: async (requestPath) => ({
        status: requestPath === '/api/auth/session' ? 200 : 204,
        body: requestPath === '/api/auth/session'
          ? {
              user: {
                id: 1,
                username: 'browser-update-check',
                isAdmin: false,
                forcePasswordChange: false,
              },
            }
          : {},
      }),
      getHardwareCapabilities: async () => ({
        controlTransport: 'AWAITING FIRMWARE IMPLEMENTATION',
        profileMapping: 'PROTOCOL MAPPING TBD',
        maintenanceTransport: 'MAINTENANCE ENDPOINT NOT YET IMPLEMENTED',
        physicalValidation: 'HARDWARE VALIDATION REQUIRED',
        canTransmit: false,
      }),
      hardwareDiscover: async (addr) => ({
         candidates: [{
            sourceAddress: addr || '192.168.1.55', socketAddress: '', socketPort: 0, vendorId: 1, deviceType: 2, productCode: 3, revision: '1.0', status: 0, serialNumber: 555, productName: 'BrowserMockDevice', state: 0, encapProtocolVersion: 1
         }]
      }),
      hardwareConnect: async (addr) => ({ state: 'connected', connected: true, address: addr, sessionHandle: 1 }),
      hardwareDisconnect: async () => ({ state: 'disconnected', connected: false, address: null, sessionHandle: null }),
      getHardwareState: async () => ({ state: 'disconnected', connected: false, address: null, sessionHandle: null }),
      hardwareGetProfileReadiness: async () => ({ readReady: false }),
      hardwareReadField: async (name) => ({ value: false, symbolicName: name }),
      hardwareArmControl: async () => ({ armed: true }),
      hardwareWriteEnable: async (enable) => ({ requested: enable, outputActive: enable }),
      onHardwareState: () => { return () => {}; },
      selectFirmwarePackage: async () => null,
      saveFile: async () => ({ saved: false }),
      getUpdateState: async () => updateState,
      checkForUpdates: async () => {
        publishUpdateState({
          status: 'up-to-date',
          currentVersion: '0.2.1',
          message: 'Version 0.2.1 is the latest available release.',
          canRetry: true,
        });
        return updateState;
      },
      deferUpdate: async () => {
        publishUpdateState({
          ...updateState,
          status: 'deferred',
          message: 'Version 0.2.2 is ready whenever you choose to install it.',
          canRetry: true,
        });
        return updateState;
      },
      installUpdate: async () => {
        publishUpdateState({
          ...updateState,
          status: 'installing',
          message: 'Starting the verified installer.',
          canRetry: false,
        });
        return updateState;
      },
      onUpdateState: (listener) => {
        updateListeners.add(listener);
        return () => updateListeners.delete(listener);
      },
    };
    window.__lsnUpdateTest = { publishUpdateState };
  });

  // Navigate to /downloads. The default profile ships with cipService: "TBD"
  // on every field, so tbdFieldCount > 0 without any additional seeding — the
  // warning renders out of the box.
  await page.goto(BASE + '/downloads');

  // ── 1. Warning box is visible ──────────────────────────────────────────────
  const warningHeading = page.locator('text=UNRESOLVED MAPPINGS DETECTED');
  await waitFor(
    () => warningHeading.isVisible().catch(() => false),
    `${label}: UNRESOLVED MAPPINGS DETECTED heading visible`,
  );
  check(await warningHeading.isVisible(), `${label}: warning heading "UNRESOLVED MAPPINGS DETECTED" is visible`);

  // ── 2. All four resolution steps are visible ───────────────────────────────
  // The steps live in an <ol> inside the warning box.
  const stepTexts = [
    'Open the',       // step 1: Open the Profile page …
    'Edit your',      // step 2: Edit your lsn_protocol_profile.json …
    'Use',            // step 3: Use Import JSON on the Profile page …
    'Return here',    // step 4: Return here — the warning clears automatically …
  ];

  const listItems = page.locator(
    'div.border.border-warning\\/40 ol li',
  );
  const itemCount = await listItems.count();
  check(itemCount === 4, `${label}: ordered list has 4 resolution steps (got ${itemCount})`);

  for (let i = 0; i < stepTexts.length; i++) {
    const item = listItems.nth(i);
    const visible = await item.isVisible().catch(() => false);
    const text = visible ? await item.textContent() : '';
    check(
      visible && text.includes(stepTexts[i]),
      `${label}: step ${i + 1} is visible and contains "${stepTexts[i]}" (got "${text?.trim().slice(0, 80)}")`,
    );
  }

  // ── 3. "Go to Profile →" link navigates to /profile ───────────────────────
  const profileLink = page.locator('a:has-text("Go to Profile")');
  check(await profileLink.isVisible(), `${label}: "Go to Profile →" link is visible`);

  // Click the link and observe Wouter's client-side URL change (no page load).
  await profileLink.click();
  await waitFor(
    () => new URL(page.url()).pathname === '/profile',
    `${label}: client-side navigation to /profile`,
  );
  const route = new URL(page.url()).pathname;
  check(
    route === '/profile',
    `${label}: "Go to Profile →" navigates to /profile (got ${route})`,
  );

  // ── 4. Warning clears for a fully resolved persisted profile ───────────────
  await page.evaluate(() => {
    const storageKey = 'lsn-console-storage';
    const persisted = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (!persisted.state?.profile || !persisted.state?.activeProfileDocument?.fields) {
      throw new Error('Expected the persisted LSN profile state to be available');
    }

    persisted.state.profile = persisted.state.profile.map((field, index) => ({
      ...field,
      cipService: field.access === 'WRITE' ? 'Set_Attribute_Single' : 'Get_Attribute_Single',
      class: '4',
      instance: '100',
      attribute: String(index + 1),
    }));
    persisted.state.activeProfileDocument = {
      ...persisted.state.activeProfileDocument,
      fields: persisted.state.activeProfileDocument.fields.map((field, index) => ({
        ...field,
        cipService: field.access === 'WRITE' ? 'Set_Attribute_Single' : 'Get_Attribute_Single',
        class: 4,
        instance: 100,
        attribute: index + 1,
      })),
    };
    localStorage.setItem(storageKey, JSON.stringify(persisted));
  });

  await page.goto(BASE + '/downloads');
  const tbdSummary = page.getByText('0 TBD', { exact: true });
  await waitFor(
    () => tbdSummary.isVisible().catch(() => false),
    `${label}: fully resolved profile summary shows zero TBD mappings`,
    20000,
  );
  check(
    !(await warningHeading.isVisible().catch(() => false)),
    `${label}: warning is absent for a profile with all concrete CIP mappings`,
  );

  await page.reload();
  await waitFor(
    () => tbdSummary.isVisible().catch(() => false),
    `${label}: resolved profile remains loaded after reload`,
    20000,
  );
  check(
    !(await warningHeading.isVisible().catch(() => false)),
    `${label}: warning remains absent after reloading the fully resolved profile`,
  );

  // ── 5. Packaged Windows default and mode-transition reset ─────────────────
  await page.goto(BASE + '/device');
  const hardwareModeButton = page.getByRole('button', { name: 'HARDWARE MODE' });
  await waitFor(
    () => hardwareModeButton.isVisible().catch(() => false),
    `${label}: Hardware Mode button visible`,
  );
  check(
    (await hardwareModeButton.getAttribute('class')).includes('border-destructive'),
    `${label}: packaged Windows runtime defaults to Hardware Mode`,
  );

  await page.getByRole('button', { name: 'SIMULATION MODE' }).click();
  await page.locator('a[href="/"]').first().click();
  await waitFor(
    () => new URL(page.url()).pathname === '/',
    `${label}: client-side navigation to Dashboard`,
  );
  const discoverButton = page.getByRole('button', { name: 'DISCOVER' });
  await discoverButton.click();
  await waitFor(
    async () => !(await discoverButton.isVisible().catch(() => false)),
    `${label}: simulated device discovery completes`,
  );
  check(
    !(await page.getByText('AWAITING DEVICE DISCOVERY').isVisible().catch(() => false)),
    `${label}: simulated identity is visible after discovery`,
  );

  await page.locator('a[href="/device"]').first().click();
  await waitFor(
    () => new URL(page.url()).pathname === '/device',
    `${label}: client-side navigation back to Device`,
  );
  await page.getByRole('button', { name: 'HARDWARE MODE' }).click();
  await page.locator('a[href="/"]').first().click();
  await waitFor(
    () => new URL(page.url()).pathname === '/',
    `${label}: client-side navigation to reset Dashboard`,
  );
  const awaitingDiscovery = page.getByText('AWAITING DEVICE DISCOVERY');
  await waitFor(
    () => awaitingDiscovery.isVisible().catch(() => false),
    `${label}: mode switch clears simulated discovery`,
  );
  check(
    await awaitingDiscovery.isVisible(),
    `${label}: switching to Hardware Mode removes the simulated ESP32 identity`,
  );
  check(
    await page.locator('#main-workspace').getByText('DISCONNECTED', { exact: true }).isVisible(),
    `${label}: switching modes resets the active connection`,
  );

  // ── Hardware Mode Discovery / Session check ───────────────────────────────
  const hardwareDiscoverBtn = page.getByRole('button', { name: 'DISCOVER' });
  await hardwareDiscoverBtn.click();
  await waitFor(
    async () => !(await hardwareDiscoverBtn.isVisible().catch(() => false)),
    `${label}: hardware device discovery completes`,
  );
  check(
    !(await page.getByText('AWAITING DEVICE DISCOVERY').isVisible().catch(() => false)),
    `${label}: hardware identity is visible after discovery`,
  );
  check(
    await page.getByText('BrowserMockDevice').isVisible(),
    `${label}: physical ListIdentity values are displayed`,
  );

  const connectBtn = page.getByRole('button', { name: 'CONNECT', exact: true });
  await connectBtn.click();
  await waitFor(
    () => page.locator('#main-workspace').getByText('CONNECTED', { exact: true }).isVisible(),
    `${label}: hardware mode connects`,
  );
  check(
    await page.locator('#main-workspace').getByText('CONNECTED', { exact: true }).isVisible(),
    `${label}: physical session connected`,
  );

  // ── 6. Desktop update progress and defer/review states ─────────────────────
  await page.evaluate(() => {
    window.__lsnUpdateTest.publishUpdateState({
      status: 'downloading',
      currentVersion: '0.2.1',
      latestVersion: '0.2.2',
      receivedBytes: 42 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024,
      percent: 42,
      message: 'Downloading version 0.2.2…',
      canRetry: false,
    });
  });
  const updateProgress = page.getByTestId('desktop-update-progress');
  await waitFor(
    () => updateProgress.isVisible().catch(() => false),
    `${label}: desktop update progress visible`,
  );
  check(
    (await updateProgress.textContent()).includes('42%'),
    `${label}: update progress shows percentage`,
  );
  check(
    (await updateProgress.textContent()).includes('42.0 MB of 100.0 MB'),
    `${label}: update progress shows downloaded and total bytes`,
  );

  await page.evaluate(() => {
    window.__lsnUpdateTest.publishUpdateState({
      status: 'ready',
      currentVersion: '0.2.1',
      latestVersion: '0.2.2',
      releaseName: 'LSN Engineering Console v0.2.2',
      message: 'Version 0.2.2 is verified and ready to install.',
      canRetry: true,
      installerTrust: 'unsigned',
    });
  });
  const readyDialog = page.getByTestId('dialog-desktop-update-ready');
  await waitFor(
    () => readyDialog.isVisible().catch(() => false),
    `${label}: verified update dialog visible`,
  );
  check(
    await page.getByTestId('button-update-install').isVisible(),
    `${label}: verified update offers Install now`,
  );
  const readyText = await readyDialog.textContent();
  check(
    readyText.includes('Unsigned update ready') &&
      readyText.includes('More info') &&
      readyText.includes('Run anyway'),
    `${label}: unsigned update explains the expected SmartScreen steps`,
  );
  await page.getByTestId('button-update-later').click();
  await waitFor(
    async () => !(await readyDialog.isVisible().catch(() => false)),
    `${label}: Later closes update dialog`,
  );

  await page.goto(BASE + '/help');
  await page.evaluate(() => {
    window.__lsnUpdateTest.publishUpdateState({
      status: 'deferred',
      currentVersion: '0.2.1',
      latestVersion: '0.2.2',
      releaseName: 'LSN Engineering Console v0.2.2',
      message: 'Version 0.2.2 is ready whenever you choose to install it.',
      canRetry: true,
      installerTrust: 'unsigned',
    });
  });
  const reviewButton = page.getByTestId('button-check-for-updates');
  await waitFor(
    () => reviewButton.isVisible().catch(() => false),
    `${label}: manual update action visible on Help`,
  );
  check(
    (await reviewButton.textContent()).includes('REVIEW UPDATE v0.2.2'),
    `${label}: deferred update remains available for manual review`,
  );
  await reviewButton.click();
  await waitFor(
    () => readyDialog.isVisible().catch(() => false),
    `${label}: deferred update can be reviewed again`,
  );
  check(
    await readyDialog.isVisible(),
    `${label}: manual review reopens verified update dialog`,
  );
  await page.getByTestId('button-update-later').click();

  await page.evaluate(() => {
    window.__lsnUpdateTest.publishUpdateState({
      status: 'error',
      currentVersion: '0.2.1',
      latestVersion: '0.2.2',
      message: 'The update failed. The installed version is unaffected.',
      errorCode: 'UPDATE_DOWNLOAD_FAILED',
      canRetry: true,
    });
  });
  const updateError = page.getByTestId('desktop-update-error');
  await waitFor(
    () => updateError.isVisible().catch(() => false),
    `${label}: nonblocking update error visible`,
  );
  check(
    (await updateError.textContent()).includes('installed version is unaffected'),
    `${label}: update failure confirms the installed version is unaffected`,
  );
  await page.getByTestId('button-update-retry').click();
  await waitFor(
    async () => !(await updateError.isVisible().catch(() => false)),
    `${label}: retry clears update error`,
  );
  check(
    !(await updateError.isVisible().catch(() => false)),
    `${label}: retry returns to a non-error update state`,
  );

  await page.close();
}

async function main() {
  if (!EXECUTABLE) throw new Error('REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE is not set');
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await downloadsWarningChecks(ctx);
    await ctx.close();
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGTERM'); // kill the whole dev-server process group
    } catch {
      server.kill('SIGTERM');
    }
  }
  console.log(`\n${checks} checks, ${failures.length} failures`);
  if (failures.length) {
    console.error(failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('Downloads warning browser regression check PASSED');
  process.exit(0); // do not linger on surviving child handles
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
