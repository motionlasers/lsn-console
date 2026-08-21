/**
 * Repeatable browser regression check for the guided tour.
 *
 * Boots the Vite dev server, drives real Chromium (playwright-core) and verifies,
 * at desktop and narrow widths:
 *  - traversal of every multi-page tour step with correct route navigation
 *  - target highlight / coachmark non-overlap and viewport containment (route scrolling)
 *  - conditional fallback when a step target is unavailable in the current mode
 *  - no unintended app state changes (connection stays disconnected, prefs untouched)
 *  - replay persistence ("Don't show again" suppresses auto-start; replay always restarts)
 *  - Escape / Back / Next behavior
 *  - modal semantics (aria-modal, focus trapping, focus restoration)
 *  - live announcements and reduced-motion behavior
 *  - opening sequence: intro → overview → detail phase ordering
 *  - phase-aware progress labels distinguish overview from detail steps
 *  - every navigation page named in overview live announcements
 *
 * Run: node tests/browser/tour-browser.mjs   (from the artifact directory)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { TOUR_STEPS, OVERVIEW_NAV_PAGES, TOUR_OVERVIEW_COUNT } from '../../src/lib/tour-data.ts';

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

function rectsOverlap(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

async function waitFor(fn, msg, timeout = 8000, interval = 50) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for: ${msg}`);
}

async function startServer() {
  // Allocate a fresh OS-assigned port so the test can never silently attach to a
  // stale or unrelated server. Vite runs with strictPort, so a rare TOCTOU
  // collision makes the child exit — which fails the run below — rather than
  // drifting to another port.
  const port = Number(process.env.TOUR_TEST_PORT ?? (await allocatePort()));
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
  console.log(`[tour-browser] dev server owned by test on port ${port} (pid ${proc.pid})`);
  return proc;
}

async function overlayState(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="tour-overlay"]');
    if (!overlay) return null;
    const card = document.querySelector('[data-testid="dialog-firmware-tour"]');
    const highlight = document.querySelector('[data-testid="tour-target-highlight"]');
    const sidebar = document.querySelector('aside[data-collapsed]');
    const sidebarNav = document.querySelector('[data-tour="sidebar-nav"]');
    const live = document.querySelector('[data-testid="tour-live-announcement"]');
    const phaseLabel = document.querySelector('[data-testid="tour-phase-label"]');
    const fallback = overlay.querySelector('[role="status"]');
    const toRect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      card: card ? toRect(card) : null,
      cardClass: card?.className ?? '',
      ariaModal: card?.getAttribute('aria-modal'),
      highlight: highlight ? toRect(highlight) : null,
      highlightClass: highlight?.className ?? '',
      sidebar: sidebar ? toRect(sidebar) : null,
      sidebarCollapsed: sidebar?.getAttribute('data-collapsed') === 'true',
      sidebarNav: sidebarNav ? toRect(sidebarNav) : null,
      live: live?.textContent ?? '',
      phaseLabel: phaseLabel?.textContent ?? '',
      fallback: fallback?.textContent ?? null,
      focusInCard: !!card && card.contains(document.activeElement),
      route: location.pathname,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
}

async function waitForStep(page, step, label) {
  return waitFor(async () => {
    const s = await overlayState(page);
    return s && s.live.includes(step.title) && s.route === step.route ? s : null;
  }, `${label}: step "${step.id}" announced on ${step.route}`);
}

async function freshTourPage(context, reducedMotion, { collapseNavigation = false } = {}) {
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.goto(BASE + '/');
  if (collapseNavigation) {
    await page.click('[data-testid="button-toggle-navigation"]');
    await waitFor(
      () => page.locator('aside[data-collapsed="true"]').count(),
      'navigation to collapse before the narrow tour',
    );
  }
  // Tour auto-starts on first launch (hasSeenTour=false) after ~500ms.
  await waitFor(async () => overlayState(page), 'tour auto-start');
  return page;
}

function assertNarrowSidebarNav(state, step, label) {
  if (state.viewport.width > 420 || step.id !== 'sidebar-nav') return;

  const { card, highlight, sidebar, sidebarNav, viewport } = state;
  check(state.sidebarCollapsed, `${label} ${step.id}: navigation is collapsed at ${viewport.width}px`);
  check(
    !!sidebar && Math.abs(sidebar.width - 64) <= 1,
    `${label} ${step.id}: collapsed sidebar is approximately 64px wide (got ${sidebar?.width ?? 'missing'})`,
  );
  check(!!sidebarNav, `${label} ${step.id}: collapsed nav target rendered`);
  if (sidebar && sidebarNav) {
    check(
      sidebarNav.left >= sidebar.left && sidebarNav.right <= sidebar.right,
      `${label} ${step.id}: nav target stays inside collapsed sidebar (${JSON.stringify(sidebarNav)} vs ${JSON.stringify(sidebar)})`,
    );
  }
  if (highlight) {
    check(
      highlight.left >= 0 && highlight.top >= 0 &&
        highlight.right <= viewport.width && highlight.bottom <= viewport.height,
      `${label} ${step.id}: collapsed-nav highlight is fully within the narrow viewport (${JSON.stringify(highlight)})`,
    );
  }
  if (highlight && card) {
    check(
      !rectsOverlap(highlight, card),
      `${label} ${step.id}: collapsed-nav highlight does not overlap coachmark (${JSON.stringify(highlight)} vs ${JSON.stringify(card)})`,
    );
  }
}

async function assertStepInvariants(state, step, label, reducedMotion) {
  check(state.ariaModal === 'true', `${label} ${step.id}: coachmark has aria-modal="true"`);
  check(state.route === step.route, `${label} ${step.id}: route is ${step.route} (got ${state.route})`);
  check(state.focusInCard, `${label} ${step.id}: focus is inside the coachmark`);
  check(state.live.includes(step.title), `${label} ${step.id}: live announcement includes title`);

  // Phase-specific announcement format checks
  const phase = step.phase ?? 'detail';
  if (phase === 'intro') {
    check(
      state.live.toLowerCase().includes('introduction') || state.live.toLowerCase().includes('navigation'),
      `${label} ${step.id}: intro live announcement mentions introduction/navigation`,
    );
    check(
      !state.phaseLabel.includes('PAGE '),
      `${label} ${step.id}: intro step does not show PAGE X/Y label`,
    );
  } else if (phase === 'overview') {
    check(
      state.live.toLowerCase().includes('overview'),
      `${label} ${step.id}: overview live announcement includes "Overview"`,
    );
    check(
      state.phaseLabel.includes('OVERVIEW'),
      `${label} ${step.id}: overview step shows OVERVIEW label (got: ${state.phaseLabel})`,
    );
    check(
      !state.phaseLabel.includes('PAGE '),
      `${label} ${step.id}: overview step does not show PAGE X/Y label`,
    );
  } else {
    check(
      state.live.includes(step.page),
      `${label} ${step.id}: detail live announcement includes page name "${step.page}"`,
    );
    check(
      state.phaseLabel.includes('PAGE '),
      `${label} ${step.id}: detail step shows PAGE X/Y label (got: ${state.phaseLabel})`,
    );
  }

  const { card, viewport } = state;
  check(!!card, `${label} ${step.id}: coachmark rendered`);
  if (card) {
    check(
      card.left >= 0 && card.top >= 0 && card.right <= viewport.width + 1 && card.bottom <= viewport.height + 1,
      `${label} ${step.id}: coachmark within viewport (${JSON.stringify(card)} vs ${JSON.stringify(viewport)})`,
    );
    if (!reducedMotion) {
      // no reduced-motion assertions on the motion run
    } else {
      check(!state.cardClass.includes('transition-[left,top]'), `${label} ${step.id}: reduced motion disables coachmark position transition`);
    }
  }
  if (state.highlight) {
    const h = state.highlight;
    // Non-overlap is required whenever some placement can geometrically fit the
    // coachmark beside the target (mirrors computeTourPosition's contract).
    const MARGIN = 12;
    const GAP = 16;
    const feasible =
      h.top - MARGIN >= card.height + GAP ||
      viewport.height - h.bottom - MARGIN >= card.height + GAP ||
      h.left - MARGIN >= card.width + GAP ||
      viewport.width - h.right - MARGIN >= card.width + GAP;
    if (feasible) {
      check(!rectsOverlap(h, card), `${label} ${step.id}: target highlight does not overlap coachmark`);
    }
    check(
      h.left >= -1 && h.top >= -1 && h.right <= viewport.width + 1 && h.bottom <= viewport.height + 1,
      `${label} ${step.id}: target scrolled into viewport (${JSON.stringify(h)})`,
    );
    if (reducedMotion) {
      check(!state.highlightClass.includes('tour-target-stroke'), `${label} ${step.id}: reduced motion disables highlight animation`);
    }
  } else {
    check(!!state.fallback && state.fallback.includes('TARGET UNAVAILABLE'), `${label} ${step.id}: missing target shows conditional fallback notice`);
  }
  assertNarrowSidebarNav(state, step, label);
}

async function assertOverviewCoverage(page, label) {
  // Collect all live announcement text from overview steps.
  const overviewSteps = TOUR_STEPS.filter(s => s.phase === 'overview');
  const collectedText = [];
  for (const step of overviewSteps) {
    const s = await waitForStep(page, step, label);
    collectedText.push(s.live);
    // Advance past this step (unless it's the last overview step; caller handles that)
    const stepIndex = TOUR_STEPS.indexOf(step);
    if (stepIndex < TOUR_STEPS.length - 1) await page.click('[data-testid="button-tour-next"]');
  }
  const combined = collectedText.join(' ');
  for (const navPage of OVERVIEW_NAV_PAGES) {
    const pageName = navPage.split(' ')[0]; // unambiguous first word is always enough
    check(
      combined.includes(navPage) || combined.includes(pageName),
      `${label}: navigation page "${navPage}" named in overview announcements`,
    );
  }
  check(
    collectedText.length === TOUR_OVERVIEW_COUNT,
    `${label}: saw ${collectedText.length} overview steps, expected ${TOUR_OVERVIEW_COUNT}`,
  );
}

async function traverse(page, label, reducedMotion) {
  const before = await page.evaluate(() => ({
    pref: localStorage.getItem('lsn-tour-preference-v1'),
    conn: document.body.textContent?.includes('DISCONNECTED'),
  }));
  for (let i = 0; i < TOUR_STEPS.length; i++) {
    const step = TOUR_STEPS[i];
    await waitForStep(page, step, label);
    // Let target settle (scroll + focus timers) before geometry assertions:
    // wait until either the highlight or the fallback notice is rendered.
    await waitFor(async () => {
      const s = await overlayState(page);
      return s && (s.highlight || s.fallback) ? s : null;
    }, `${label}: step "${step.id}" highlight or fallback rendered`).catch(() => {});
    await sleep(reducedMotion ? 150 : 450);
    const settled = await waitForStep(page, step, label);
    await assertStepInvariants(settled, step, label, reducedMotion);
    if (step.id === 'device-hardware-lock') {
      check(settled.highlight === null && !!settled.fallback, `${label}: hardware-lock step falls back safely in simulation mode`);
    }
    if (i < TOUR_STEPS.length - 1) await page.click('[data-testid="button-tour-next"]');
  }
  // Finish on last step must close the overlay without persisting suppression.
  await page.click('[data-testid="button-tour-finish"]');
  await waitFor(async () => !(await overlayState(page)), `${label}: overlay closes on FINISH`);
  const after = await page.evaluate(() => ({
    pref: JSON.parse(localStorage.getItem('lsn-tour-preference-v1') ?? '{}'),
    conn: document.body.textContent?.includes('DISCONNECTED'),
  }));
  check(after.pref?.state?.hasSeenTour === false, `${label}: FINISH without "don't show again" keeps replay enabled`);
  check(before.conn === true && after.conn === true, `${label}: traversal caused no connection state change`);
}

async function keyboardAndPersistenceChecks(context) {
  const label = 'keyboard';
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE + '/settings');
  // Dismiss the auto-started tour, then start deliberately from the replay button.
  await waitFor(async () => overlayState(page), 'auto tour');
  await page.keyboard.press('Escape');
  await waitFor(async () => !(await overlayState(page)), 'Escape closes auto tour');
  check(true, 'Escape closes the tour');

  // The auto-started tour navigates to the first step's route; return to Settings.
  await page.goto(BASE + '/settings');
  const replay = page.locator('[data-testid="button-settings-replay-tour"]');
  await replay.focus();
  await replay.press('Enter');
  const first = TOUR_STEPS[0];
  await waitForStep(page, first, label);
  await sleep(200);

  // Back is disabled on the first step; Next advances; Back returns.
  check(await page.locator('[data-testid="button-tour-back"]').isDisabled(), `${label}: BACK disabled on first step`);
  await page.click('[data-testid="button-tour-next"]');
  await waitForStep(page, TOUR_STEPS[1], label);
  await page.click('[data-testid="button-tour-back"]');
  await waitForStep(page, first, label);
  check(true, `${label}: NEXT then BACK returns to the first step`);

  // Focus trap: Tab cycles within the dialog; Shift+Tab from first wraps to last.
  await sleep(200);
  const focusables = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="dialog-firmware-tour"]');
    return Array.from(card.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .map((el) => el.getAttribute('data-testid') ?? el.id ?? el.tagName);
  });
  check(focusables.length >= 4, `${label}: dialog exposes focusable controls (${focusables.join(', ')})`);
  const trapped = [];
  for (let i = 0; i < focusables.length + 2; i++) {
    await page.keyboard.press('Tab');
    trapped.push(await page.evaluate(() => {
      const card = document.querySelector('[data-testid="dialog-firmware-tour"]');
      return card.contains(document.activeElement)
        ? (document.activeElement.getAttribute('data-testid') ?? document.activeElement.id ?? 'in-card')
        : 'ESCAPED-TRAP';
    }));
  }
  check(!trapped.includes('ESCAPED-TRAP'), `${label}: Tab never leaves the dialog (${trapped.join(' > ')})`);
  // Move to first focusable, then Shift+Tab must wrap to last.
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="dialog-firmware-tour"]');
    card.querySelector('button:not([disabled]), input:not([disabled])').focus();
  });
  await page.keyboard.press('Shift+Tab');
  const wrapped = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="dialog-firmware-tour"]');
    return card.contains(document.activeElement);
  });
  check(wrapped, `${label}: Shift+Tab from first focusable wraps within the dialog`);

  // Escape closes and restores focus to the replay trigger.
  await page.keyboard.press('Escape');
  await waitFor(async () => !(await overlayState(page)), 'Escape closes replayed tour');
  await sleep(150);
  // The tour navigated to the first step's route, so the Settings trigger is
  // disconnected; restoration must land on the trigger if still present,
  // otherwise on the documented fallback (current-page nav link / main workspace).
  const focused = await page.evaluate(() => ({
    testId: document.activeElement?.getAttribute('data-testid'),
    isFallback:
      document.activeElement === document.querySelector('[aria-current="page"]') ||
      document.activeElement === document.querySelector('#main-workspace'),
  }));
  check(
    focused.testId === 'button-settings-replay-tour' || focused.isFallback,
    `${label}: focus restored to trigger or safe fallback (got ${focused.testId})`,
  );
  const prefAfterEscape = await page.evaluate(() => JSON.parse(localStorage.getItem('lsn-tour-preference-v1') ?? '{}'));
  check(prefAfterEscape?.state?.hasSeenTour === false, `${label}: Escape does not suppress future tours`);

  // "Don't show again" persistence: check the box, close, reload — no auto start.
  await page.goto(BASE + '/settings');
  await replay.click();
  await waitForStep(page, first, label);
  await page.click('[data-testid="checkbox-dont-show-tour"]');
  await page.click('[data-testid="button-close-tour"]');
  await waitFor(async () => !(await overlayState(page)), 'close persists suppression');
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('lsn-tour-preference-v1') ?? '{}'));
  check(pref?.state?.hasSeenTour === true, `${label}: "don't show again" persisted`);
  await page.reload();
  await sleep(1500);
  check(!(await overlayState(page)), `${label}: suppressed tour does not auto-start after reload`);
  // Replay always restarts regardless of suppression.
  await page.goto(BASE + '/settings');
  await page.click('[data-testid="button-settings-replay-tour"]');
  const replayed = await waitForStep(page, first, label);
  // First step is the intro; check it is announced as intro/navigation
  check(
    replayed.live.toLowerCase().includes('introduction') || replayed.live.toLowerCase().includes('navigation'),
    `${label}: replay restarts from the intro step with navigation announcement`,
  );
  await page.keyboard.press('Escape');
  await page.close();
}

async function overviewSequenceChecks(context) {
  const label = 'overview-seq';
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE + '/');
  await waitFor(async () => overlayState(page), 'tour auto-start for overview check');

  // Intro steps: advance through every intro step before reaching the overview
  const introSteps = TOUR_STEPS.filter(s => s.phase === 'intro');
  for (let i = 0; i < introSteps.length; i++) {
    const introStep = introSteps[i];
    const introState = await waitForStep(page, introStep, label);
    check(introState.phaseLabel.includes('INTRO'), `${label}: intro step ${i} shows INTRO label (got: ${introState.phaseLabel})`);
    check(!introState.phaseLabel.includes('OVERVIEW'), `${label}: intro step ${i} does not show OVERVIEW label`);
    check(!introState.phaseLabel.includes('PAGE '), `${label}: intro step ${i} does not show PAGE label`);
    await page.click('[data-testid="button-tour-next"]');
  }

  // Steps after intro: overview
  await assertOverviewCoverage(page, label);

  // Next step after overview should be first detail (Dashboard)
  const firstDetailStep = TOUR_STEPS.find(s => (s.phase ?? 'detail') === 'detail');
  const detailState = await waitForStep(page, firstDetailStep, label);
  check(detailState.phaseLabel.includes('PAGE '), `${label}: first detail step shows PAGE label (got: ${detailState.phaseLabel})`);
  check(!detailState.phaseLabel.includes('OVERVIEW'), `${label}: first detail step does not show OVERVIEW label`);
  check(
    detailState.live.includes(firstDetailStep.page),
    `${label}: first detail live announcement includes page name "${firstDetailStep.page}"`,
  );

  await page.keyboard.press('Escape');
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
    // The scenarios use isolated contexts (independent storage) and run
    // concurrently to keep the check within the validation runner's time budget.
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const narrow = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const kb = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ovCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await Promise.all([
      // Desktop, normal motion: full traversal.
      freshTourPage(desktop, false).then((page) => traverse(page, 'desktop', false)),
      // Narrow, reduced motion: full traversal.
      freshTourPage(narrow, true, { collapseNavigation: true }).then((page) => traverse(page, 'narrow', true)),
      // Keyboard, focus, and persistence checks.
      keyboardAndPersistenceChecks(kb),
      // Overview sequence, coverage, and phase-label checks.
      overviewSequenceChecks(ovCtx),
    ]);
    await Promise.all([desktop.close(), narrow.close(), kb.close(), ovCtx.close()]);
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
  console.log('Guided tour browser regression check PASSED');
  process.exit(0); // do not linger on surviving child handles
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
