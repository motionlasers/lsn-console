/**
 * Browser regression check for the Downloads page TBD-mapping warning box.
 *
 * Boots the Vite dev server, drives real Chromium (playwright-core) and verifies:
 *  - the UNRESOLVED MAPPINGS DETECTED warning appears on /downloads for the
 *    default profile (which ships with cipService: "TBD" on every field)
 *  - all four resolution steps in the ordered list are visible
 *  - clicking "Go to Profile →" navigates to /profile
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

  // Click the link and wait for navigation to /profile.
  await Promise.all([
    page.waitForURL('**/profile', { timeout: 8000 }),
    profileLink.click(),
  ]);
  const route = new URL(page.url()).pathname;
  check(
    route === '/profile',
    `${label}: "Go to Profile →" navigates to /profile (got ${route})`,
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
