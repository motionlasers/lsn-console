/**
 * Browser regression check for the end-to-end profile governance role workflows.
 *
 * Boots the Vite dev server, drives real Chromium (playwright-core) and proves,
 * with one fresh browser context per canonical role, the visible workflows each
 * role must be able to complete against the current app API contracts:
 *
 *  1) FIRMWARE_ADMIN on /profile — the full Device Profile editor is editable
 *     (timing RPI + a field CIP class change), SAVE DRAFT sends the changed
 *     document, and the Firmware Integration Package dialog lists only a version
 *     that has an actual DEVELOPMENT publication, displaying its exact version
 *     number and digest.
 *  2) CLIENT_REVIEWER on /profile-review — isolated RPI/timeout/tolerance/expected
 *     response inputs are editable, SAVE SANDBOX sends the private document, RUN
 *     SIMULATION shows PASS and posts version-bound isolated evidence, a comment
 *     is added and a decision approved; real HTTP requests evaluated by the API
 *     server's centralized permission policy deny draft mutation and audit reads.
 *  3) SUPERADMIN on /settings — the user-role governance card and the governance
 *     audit history are visible; changing a role sends the expected update and a
 *     real profile lifecycle audit row (actor + action) is visible.
 *
 * Each role runs against a fully deterministic in-page mock of
 * window.lsnDesktop.authRequest that matches the real /api contracts. The tour,
 * What's New, and desktop update UIs are suppressed, and the run asserts there
 * were no page errors or console errors.
 *
 * Owns a freshly allocated Vite port, verifies the response is really the app,
 * fails if the child dies, tears down the whole process group, and exits
 * explicitly (see .agents/memory/browser-validation-checks.md).
 *
 * Run: node tests/browser/role-workflows-browser.mjs   (from the artifact directory)
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
let DENIAL_BASE = ''; // real HTTP fixture using the API server's permission policy

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

async function waitFor(fn, msg, timeout = 10000, interval = 50) {
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
  const port = Number(process.env.ROLE_WORKFLOWS_TEST_PORT ?? (await allocatePort()));
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
  console.log(`[role-workflows-browser] dev server owned by test on port ${port} (pid ${proc.pid})`);
  return proc;
}

async function startDenialServer() {
  const port = Number(process.env.ROLE_WORKFLOWS_DENIAL_PORT ?? (await allocatePort()));
  DENIAL_BASE = `http://127.0.0.1:${port}`;
  const apiDir = path.resolve(ARTIFACT_DIR, '..', 'api-server');
  const builtEntry = `/tmp/lsn-profile-denial-${port}.cjs`;
  const build = spawn(
    'pnpm',
    [
      'exec',
      'esbuild',
      'tests/server-denial-entry.ts',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${builtEntry}`,
    ],
    {
      cwd: apiDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let buildStderr = '';
  build.stderr.on('data', (d) => { buildStderr += String(d); });
  const buildExit = await new Promise((resolve) => build.on('exit', resolve));
  if (buildExit !== 0) {
    throw new Error(`Unable to build production-router denial server: ${buildStderr}`);
  }
  const proc = spawn(
    'node',
    [builtEntry],
    {
      cwd: apiDir,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  proc.stderr.on('data', (d) => process.stderr.write(`[denial-api] ${d}`));
  let exited = null;
  proc.on('exit', (code, signal) => { exited = { code, signal }; });
  await waitFor(async () => {
    if (exited) throw new Error(`denial server exited before serving (code ${exited.code}, signal ${exited.signal})`);
    try {
      const res = await fetch(DENIAL_BASE + '/health');
      const body = res.ok ? await res.json() : {};
      return body.router === 'api-server/src/routes/profiles.ts';
    } catch {
      return false;
    }
  }, `API permission-policy server to respond on port ${port}`, 30000, 100);
  console.log(`[role-workflows-browser] real denial server owned by test on port ${port} (pid ${proc.pid})`);
  return proc;
}

// ─── Deterministic mock dataset ───────────────────────────────────────────────
// The seed is a minimal but schema-valid Device Profile document. It is used
// verbatim as the immutable version snapshot and the review snapshot, and its
// timing/fields drive the client-review sandbox seeding logic.
const MOCK_SEED = {
  DIGEST_V1: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  PROFILE_ID: 7,
  VERSION_ID: 42,
  VERSION_NUMBER: 3,
  REVIEW_ID: 9,
  REVIEW_DIGEST: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
};

// A schema-valid Device Profile document with an explicit timing block and two
// fully-populated fields so the sandbox simulation reaches PASS deterministically.
function buildProfileDocument() {
  return {
    $schema: '../schemas/device-profile.schema.json',
    profileVersion: '0.1.0',
    protocolVersion: 'LSN v0.1',
    displayName: 'LSN Development Controller',
    hardwareFamily: 'WT32-ETH01',
    supportedFirmware: ['0.1.x', '0.2.x-development'],
    identity: {
      vendorId: null,
      deviceType: null,
      productCode: null,
      productName: 'LSN Development Controller',
      mappingState: 'TBD',
    },
    capabilities: {
      interlock: { enabled: false, phase: 'future', description: 'Optional monitored interlock input.' },
      remoteStop: { enabled: false, phase: 'future', description: 'Optional remote-stop input.' },
      sensors: { enabled: false, phase: 'future', description: 'Optional sensor and module fields.' },
    },
    // Timeout 1000 seeds sandbox RPI = round(1000/2) = 500 (within 1..3200); tolerance 250 <= 500; timeout 1000 > 500 → PASS.
    timing: { explicitMessageTimeoutMs: 1000, reconnectIntervalMs: 2000, runtimeToleranceMs: 250 },
    fields: [
      {
        symbolicName: 'EmissionEnableRequest',
        direction: 'PC_TO_LSN',
        dataType: 'boolean',
        access: 'WRITE',
        cipService: 'Set_Attribute_Single',
        class: 100,
        instance: 1,
        attribute: 1,
        assembly: null,
        implementationStatus: 'IMPLEMENTED',
        simulationStatus: 'VERIFIED',
        description: 'Requests activation or deactivation of the LSN emission-control function.',
        expectedFirmwareBehavior: 'Validate the request and activate the control output only when permitted.',
        expectedReportedResponse: 'Requested state is acknowledged.',
        notes: 'This is an emission-control request, not proof of optical emission.',
      },
      {
        symbolicName: 'Ready',
        direction: 'LSN_TO_PC',
        dataType: 'boolean',
        access: 'READ',
        cipService: 'Get_Attribute_Single',
        class: 100,
        instance: 1,
        attribute: 2,
        assembly: null,
        implementationStatus: 'IMPLEMENTED',
        simulationStatus: 'VERIFIED',
        description: 'Reports whether LSN is initialized and ready to evaluate control requests.',
        expectedFirmwareBehavior: 'Report whether the LSN state machine is initialized.',
        expectedReportedResponse: 'Boolean Ready state.',
        notes: 'Ready does not mean emission control is active.',
      },
    ],
    faults: [],
    tests: [],
    modules: [],
  };
}

// Canonical session identities per role. userId/permissions/isAdmin follow the
// SessionUser contract consumed by AuthContext / useRoles / settings.
const ROLE_SESSIONS = {
  FIRMWARE_ADMIN: {
    userId: 11,
    username: 'firmware-admin',
    role: 'FIRMWARE_ADMIN',
    permissions: ['profile.edit', 'profile.publish'],
    isAdmin: false,
    forcePasswordChange: false,
  },
  CLIENT_REVIEWER: {
    userId: 22,
    username: 'client-reviewer',
    role: 'CLIENT_REVIEWER',
    permissions: ['review.comment', 'review.decide'],
    isAdmin: false,
    forcePasswordChange: false,
  },
  SUPERADMIN: {
    userId: 33,
    username: 'superadmin',
    role: 'SUPERADMIN',
    permissions: ['*'],
    isAdmin: true,
    forcePasswordChange: false,
  },
};

// The addInitScript runs before any app code. It installs a fully deterministic
// window.lsnDesktop mock whose authRequest routes every /api endpoint the target
// pages hit, records every request into window.__mockRequests, and (for the
// client role) returns 403 for shared-draft mutation and audit reads. The tour,
// What's New, and desktop update surfaces are suppressed so the assertions on
// each page are deterministic.
function seedInitScript() {
  return (args) => {
    const { session, seed } = args;
    // ── Suppress guided tour / What's New / update banners ──────────────────
    localStorage.setItem(
      'lsn-tour-preference-v1',
      JSON.stringify({ state: { hasSeenTour: true, isTourActive: false, currentStep: 0 }, version: 0 }),
    );
    localStorage.setItem('lsn-whats-new-acknowledged-version', '0.3.0');

    const clone = (v) => JSON.parse(JSON.stringify(v));
    const isClient = session.role === 'CLIENT_REVIEWER';
    const now = () => new Date('2024-01-02T03:04:05.000Z').toISOString();

    // Recorded request log for page-side assertions.
    window.__mockRequests = [];

    // Mutable in-memory governance state.
    const version = {
      id: seed.VERSION_ID,
      profileId: seed.PROFILE_ID,
      versionNumber: seed.VERSION_NUMBER,
      document: clone(seed.document),
      state: 'DEVELOPMENT_PUBLISHED',
      createdAt: now(),
      createdBy: 11,
      digest: seed.DIGEST_V1,
      provenance: {},
    };
    // A DRAFT snapshot version so the reviewer has a prior version for the diff.
    const draftVersion = {
      id: seed.VERSION_ID - 1,
      profileId: seed.PROFILE_ID,
      versionNumber: seed.VERSION_NUMBER - 1,
      document: clone(seed.document),
      state: 'SUPERSEDED',
      createdAt: now(),
      createdBy: 11,
      digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      provenance: {},
    };
    const publications = [
      {
        id: 1,
        profileId: seed.PROFILE_ID,
        versionId: seed.VERSION_ID,
        channel: 'DEVELOPMENT',
        digest: seed.DIGEST_V1,
        active: true,
        publishedAt: now(),
        supersededAt: null,
      },
    ];
    const review = {
      id: seed.REVIEW_ID,
      profileId: seed.PROFILE_ID,
      versionId: seed.VERSION_ID,
      digest: seed.REVIEW_DIGEST,
      state: 'OPEN',
      snapshot: clone(seed.document),
      submittedAt: now(),
      submittedBy: 11,
    };
    const comments = [];
    const decisions = [];
    const auditLog = [
      {
        id: 1,
        profileId: seed.PROFILE_ID,
        versionId: seed.VERSION_ID,
        action: 'DEVELOPMENT_PUBLISHED',
        actorId: 11,
        actorUsername: 'firmware-admin',
        actorRole: 'FIRMWARE_ADMIN',
        detail: { channel: 'DEVELOPMENT' },
        createdAt: now(),
      },
    ];
    let sandbox = null;
    const users = [
      { id: 33, username: 'superadmin', role: 'SUPERADMIN', isAdmin: true, forcePasswordChange: false, createdAt: now() },
      { id: 11, username: 'firmware-admin', role: 'FIRMWARE_ADMIN', isAdmin: false, forcePasswordChange: false, createdAt: now() },
      { id: 22, username: 'client-reviewer', role: 'CLIENT_REVIEWER', isAdmin: false, forcePasswordChange: false, createdAt: now() },
    ];

    const governedProfile = {
      id: seed.PROFILE_ID,
      key: 'wt32-eth01-0-1-0',
      name: 'LSN Development Controller',
      description: 'Governed LSN Device Profile',
      createdAt: now(),
      updatedAt: now(),
    };
    const storedGovernedDraft = localStorage.getItem('__role-workflow-governed-draft');
    let governedDraft = storedGovernedDraft
      ? JSON.parse(storedGovernedDraft)
      : {
        id: 1,
        profileId: seed.PROFILE_ID,
        document: {
          ...clone(seed.document),
          displayName: 'SERVER GOVERNED DRAFT',
          timing: {
            ...clone(seed.document.timing),
            reconnectIntervalMs: 640,
          },
        },
        revision: 8,
        updatedAt: now(),
        updatedBy: 11,
      };

    const summaryFor = (v) => ({
      fieldCount: v.document.fields.length,
      mappedFieldCount: v.document.fields.length,
      mappingComplete: true,
      partial: false,
      limitations: [],
      simulation: null,
      hardware: null,
    });

    const ok = (body, status = 200) => ({ status, body: body === undefined ? {} : body });
    const err = (status, message) => ({ status, body: { error: message } });

    const match = (pattern, url) => {
      // pattern like '/api/profiles/:id/draft' → captures
      const pParts = pattern.split('/');
      const uParts = url.split('?')[0].split('/');
      if (pParts.length !== uParts.length) return null;
      const params = {};
      for (let i = 0; i < pParts.length; i += 1) {
        if (pParts[i].startsWith(':')) params[pParts[i].slice(1)] = uParts[i];
        else if (pParts[i] !== uParts[i]) return null;
      }
      return params;
    };

    const route = (path, method, bodyStr) => {
      const body = bodyStr ? JSON.parse(bodyStr) : undefined;
      let p;

      // Auth session
      if (path === '/api/auth/session') return ok(session);
      if (path === '/api/auth/logout') return ok({ ok: true });
      if (path === '/api/auth/change-password') return ok({ ok: true });

      // Admin users
      if (path === '/api/admin/users' && method === 'GET') {
        if (session.role !== 'SUPERADMIN') return err(403, 'Superadmin required');
        return ok(clone(users));
      }
      if ((p = match('/api/admin/users/:id', path)) && method === 'PUT') {
        if (session.role !== 'SUPERADMIN') return err(403, 'Superadmin required');
        const target = users.find((u) => String(u.id) === p.id);
        if (!target) return err(404, 'User not found');
        if (body?.role) target.role = body.role;
        if (typeof body?.isAdmin === 'boolean') target.isAdmin = body.isAdmin;
        return ok(clone(target));
      }

      // Profiles
      if (path === '/api/profiles' && method === 'GET') return ok([clone(governedProfile)]);
      if (path === '/api/profiles' && method === 'POST') return ok(clone(governedProfile));

      // Draft (shared) — mutation is denied for the client reviewer role.
      if ((p = match('/api/profiles/:id/draft', path)) && method === 'PUT') {
        if (isClient) return err(403, 'Client reviewers cannot modify the shared draft');
        if (body?.expectedRevision !== governedDraft.revision) {
          return err(409, 'Draft revision conflict');
        }
        governedDraft = {
          ...governedDraft,
          document: clone(body?.document ?? governedDraft.document),
          revision: governedDraft.revision + 1,
          updatedAt: now(),
          updatedBy: session.userId,
        };
        localStorage.setItem('__role-workflow-governed-draft', JSON.stringify(governedDraft));
        return ok(clone(governedDraft));
      }
      if ((p = match('/api/profiles/:id/draft', path)) && method === 'GET') {
        return ok(clone(governedDraft));
      }
      if ((p = match('/api/profiles/:id/submit', path)) && method === 'POST') {
        if (isClient) return err(403, 'Client reviewers cannot submit drafts');
        if (body?.expectedRevision !== governedDraft.revision) return err(409, 'Draft revision conflict');
        governedDraft = {
          ...governedDraft,
          revision: governedDraft.revision + 1,
          updatedAt: now(),
          updatedBy: session.userId,
        };
        localStorage.setItem('__role-workflow-governed-draft', JSON.stringify(governedDraft));
        return ok({ ok: true, draft: clone(governedDraft) });
      }

      // Versions / history
      if ((p = match('/api/profiles/:id/versions', path)) && method === 'GET') {
        return ok([clone(version), clone(draftVersion)]);
      }
      if ((p = match('/api/profiles/versions/:vid', path)) && method === 'GET') {
        return ok({ version: clone(version), summary: summaryFor(version) });
      }
      if ((p = match('/api/profiles/versions/:vid/validations', path)) && method === 'GET') {
        return ok([]);
      }
      if ((p = match('/api/profiles/versions/:vid/simulation', path)) && method === 'POST') {
        return ok({ ok: true, passed: body?.passed, evidence: body?.evidence });
      }
      if ((p = match('/api/profiles/versions/:vid/publish', path)) && method === 'POST') {
        if (isClient) return err(403, 'Client reviewers cannot publish');
        return ok({ ok: true });
      }

      // Diff
      if (path.startsWith('/api/profiles/diff')) {
        return ok({ counts: { field: 0, mapping: 1, timing: 1, behavior: 0 }, changes: [] });
      }

      // Reviews & decisions
      if ((p = match('/api/profiles/:id/reviews', path)) && method === 'GET') {
        return ok([clone(review)]);
      }
      if ((p = match('/api/profiles/reviews/:rid', path)) && method === 'GET') {
        return ok({ review: clone(review), comments: clone(comments), decisions: clone(decisions), summary: {} });
      }
      if ((p = match('/api/profiles/reviews/:rid/comments', path)) && method === 'POST') {
        const comment = {
          id: comments.length + 1,
          reviewId: seed.REVIEW_ID,
          authorId: session.userId,
          authorUsername: session.username,
          authorRole: session.role,
          body: body?.body ?? '',
          target: body?.target,
          createdAt: new Date().toISOString(),
        };
        comments.push(comment);
        return ok(clone(comment));
      }
      if ((p = match('/api/profiles/reviews/:rid/decision', path)) && method === 'POST') {
        const decision = {
          id: decisions.length + 1,
          reviewId: seed.REVIEW_ID,
          actorId: session.userId,
          actorUsername: session.username,
          actorRole: session.role,
          decision: body?.decision,
          rationale: body?.rationale ?? null,
          decidedAt: new Date().toISOString(),
        };
        decisions.push(decision);
        return ok(clone(decision));
      }

      // Sandbox (private, isolated)
      if ((p = match('/api/profiles/:id/sandbox', path)) && method === 'GET') {
        return ok(sandbox ? clone(sandbox) : null);
      }
      if ((p = match('/api/profiles/:id/sandbox', path)) && method === 'PUT') {
        sandbox = {
          profileId: seed.PROFILE_ID,
          reviewerId: session.userId,
          document: body?.document ?? clone(seed.document),
          updatedAt: new Date().toISOString(),
        };
        return ok(clone(sandbox));
      }
      if ((p = match('/api/profiles/:id/sandbox', path)) && method === 'DELETE') {
        sandbox = null;
        return ok({ ok: true });
      }

      // Publications
      if ((p = match('/api/profiles/:id/publications', path)) && method === 'GET') {
        return ok(clone(publications));
      }

      // Audit — reading is denied for the client reviewer role.
      if ((p = match('/api/profiles/:id/audit', path)) && method === 'GET') {
        if (isClient) return err(403, 'Client reviewers cannot read the governance audit log');
        return ok(clone(auditLog));
      }

      return err(404, `No mock route for ${method} ${path}`);
    };

    const authRequest = async (path, method = 'GET', bodyStr) => {
      const response = route(path, method, bodyStr);
      window.__mockRequests.push({ path, method, body: bodyStr ? JSON.parse(bodyStr) : undefined, status: response.status });
      return response;
    };

    // Expose a page-side helper so a test can issue a real bridge request and
    // observe the mocked status (used to prove the client sees 403 denials).
    window.__mockAuthRequest = (path, method, body) => authRequest(path, method, body);

    window.lsnDesktop = {
      getPlatform: async () => ({ platform: 'linux', packaged: false, appVersion: '0.3.0' }),
      authRequest,
      getHardwareCapabilities: async () => ({
        controlTransport: 'AWAITING FIRMWARE IMPLEMENTATION',
        profileMapping: 'PROTOCOL MAPPING TBD',
        maintenanceTransport: 'MAINTENANCE ENDPOINT NOT YET IMPLEMENTED',
        physicalValidation: 'HARDWARE VALIDATION REQUIRED',
        canTransmit: false,
      }),
      hardwareDiscover: async () => ({ candidates: [] }),
      hardwareConnect: async (addr) => ({ state: 'connected', connected: true, address: addr, sessionHandle: 1 }),
      hardwareDisconnect: async () => ({ state: 'disconnected', connected: false, address: null, sessionHandle: null }),
      getHardwareState: async () => ({ state: 'disconnected', connected: false, address: null, sessionHandle: null }),
      hardwareGetProfileReadiness: async () => ({ readReady: false }),
      hardwareReadField: async (name) => ({ value: false, symbolicName: name }),
      hardwareArmControl: async () => ({ armed: true }),
      hardwareWriteEnable: async (enable) => ({ requested: enable, outputActive: enable }),
      onHardwareState: () => () => {},
      selectFirmwarePackage: async () => null,
      saveFile: async () => ({ saved: false }),
      getUpdateState: async () => ({ status: 'up-to-date', currentVersion: '0.3.0', message: 'Latest.', canRetry: true }),
      checkForUpdates: async () => ({ status: 'up-to-date', currentVersion: '0.3.0', message: 'Latest.', canRetry: true }),
      deferUpdate: async () => ({ status: 'deferred', currentVersion: '0.3.0', canRetry: true }),
      installUpdate: async () => ({ status: 'installing', currentVersion: '0.3.0', canRetry: false }),
      onUpdateState: () => () => {},
      getProfileChannelState: async () => ({ active: null, lastKnownGood: null, staged: null, bundled: null, checking: false, error: null }),
      checkForProfileUpdate: async () => ({ active: null, lastKnownGood: null, staged: null, bundled: null, checking: false, error: null }),
      activateProfileUpdate: async () => ({ active: null, lastKnownGood: null, staged: null, bundled: null, checking: false, error: null }),
      rollbackProfile: async () => ({ active: null, lastKnownGood: null, staged: null, bundled: null, checking: false, error: null }),
      discardStagedProfile: async () => ({ active: null, lastKnownGood: null, staged: null, bundled: null, checking: false, error: null }),
      onProfileChannelState: () => () => {},
    };
  };
}

// Attach page-error / console-error listeners so a workflow failure surfaces.
function watchPageErrors(page, label) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore benign network noise that never occurs with the mock bridge.
      if (text.includes('Failed to load resource')) return;
      errors.push(`console.error: ${text}`);
    }
  });
  return () => {
    check(errors.length === 0, `${label}: no page/console errors (${errors.slice(0, 3).join(' | ')})`);
  };
}

async function newRolePage(browser, role, seed) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  if (process.env.ROLE_WORKFLOWS_DEBUG) {
    page.on('pageerror', (e) => console.log(`[${role}] PAGEERR`, e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[${role}] CONSOLE.error`, m.text()); });
  }
  const session = ROLE_SESSIONS[role];
  await page.addInitScript(seedInitScript(), { session, seed });
  return { context, page };
}

function requestLog(page) {
  return page.evaluate(() => window.__mockRequests ?? []);
}

// ─── 1) FIRMWARE_ADMIN /profile ───────────────────────────────────────────────
async function firmwareAdminChecks(browser, seed) {
  const label = 'firmware-admin';
  const { context, page } = await newRolePage(browser, 'FIRMWARE_ADMIN', seed);
  const finishErrors = watchPageErrors(page, label);

  await page.goto(BASE + '/profile');

  // The full editor is present and editable for the Firmware Admin.
  const editor = page.getByTestId('device-profile-editor');
  await waitFor(() => editor.isVisible().catch(() => false), `${label}: device profile editor visible`);
  check(await editor.isVisible(), `${label}: full Device Profile editor is visible`);
  check(
    await page.getByTestId('input-display-name').inputValue() === 'SERVER GOVERNED DRAFT',
    `${label}: editor hydrates from the pre-existing governed server Draft`,
  );

  // Change the timing RPI (reconnect interval) input.
  const rpiInput = page.getByTestId('input-timing-rpi');
  check(await rpiInput.isEditable(), `${label}: timing RPI input is editable`);
  check(await rpiInput.inputValue() === '640', `${label}: server Draft timing is shown instead of the local default`);
  await rpiInput.fill('750');

  // Change the first field's CIP class.
  const classInput = page.getByTestId('input-field-class-0');
  check(await classInput.isEditable(), `${label}: field CIP class input is editable`);
  await classInput.fill('222');

  // Save draft — sends the changed document via PUT /draft.
  const saveButton = page.getByTestId('button-save-governed-draft');
  await waitFor(async () => await saveButton.isEnabled().catch(() => false), `${label}: SAVE DRAFT enabled after valid edits`);
  await saveButton.click();
  await waitFor(async () => {
    const log = await requestLog(page);
    return log.some((r) => r.method === 'PUT' && r.path.endsWith('/draft'));
  }, `${label}: SAVE DRAFT issues a PUT /draft`);

  const log = await requestLog(page);
  const draftPut = log.filter((r) => r.method === 'PUT' && r.path.endsWith('/draft')).pop();
  check(!!draftPut, `${label}: a PUT /draft request was sent`);
  const savedDoc = draftPut?.body?.document;
  check(
    savedDoc?.timing?.reconnectIntervalMs === 750,
    `${label}: saved draft carries the changed timing RPI (750), got ${savedDoc?.timing?.reconnectIntervalMs}`,
  );
  check(
    savedDoc?.fields?.[0]?.class === 222,
    `${label}: saved draft carries the changed CIP class (222), got ${savedDoc?.fields?.[0]?.class}`,
  );
  check(draftPut?.body?.expectedRevision === 8, `${label}: SAVE DRAFT uses governed revision 8 for conflict protection`);
  check(draftPut?.status === 200, `${label}: SAVE DRAFT returned 200`);

  // A reload must rehydrate from the persisted governed Draft, not the bundled
  // browser-store default.
  await page.reload();
  await waitFor(() => page.getByTestId('device-profile-editor').isVisible().catch(() => false), `${label}: editor visible after reload`);
  check(await page.getByTestId('input-timing-rpi').inputValue() === '750', `${label}: saved server Draft timing survives reload`);
  check(await page.getByTestId('input-field-class-0').inputValue() === '222', `${label}: saved server Draft CIP mapping survives reload`);

  // Open the Firmware Integration Package dialog.
  await page.getByTestId('button-open-firmware-package').click();
  const versionSelect = page.getByTestId('select-firmware-package-version');
  await waitFor(() => versionSelect.isVisible().catch(() => false), `${label}: firmware package dialog visible`);

  // Only the version with an actual DEVELOPMENT publication should be listed.
  const optionValues = await versionSelect.locator('option').evaluateAll((opts) =>
    opts.map((o) => ({ value: o.value, text: o.textContent?.trim() })),
  );
  const selectable = optionValues.filter((o) => o.value !== '');
  check(selectable.length === 1, `${label}: exactly one published-to-DEVELOPMENT version is listed (got ${selectable.length})`);
  check(
    String(selectable[0]?.value) === String(seed.VERSION_ID),
    `${label}: listed version is the published version id ${seed.VERSION_ID} (got ${selectable[0]?.value})`,
  );

  // Select it and verify the exact version number and digest are displayed.
  await versionSelect.selectOption(String(seed.VERSION_ID));
  const govVersion = page.getByTestId('text-governed-version');
  const govDigest = page.getByTestId('text-governed-digest');
  await waitFor(() => govVersion.isVisible().catch(() => false), `${label}: governed identity block visible`);
  check(
    (await govVersion.textContent())?.includes(`Version ${seed.VERSION_NUMBER}`),
    `${label}: dialog displays exact version number ${seed.VERSION_NUMBER}`,
  );
  check(
    (await govDigest.textContent())?.trim() === seed.DIGEST_V1,
    `${label}: dialog displays exact digest`,
  );

  finishErrors();
  await page.close();
  await context.close();
}

// ─── 2) CLIENT_REVIEWER /profile-review ───────────────────────────────────────
async function clientReviewerChecks(browser, seed) {
  const label = 'client-reviewer';
  const { context, page } = await newRolePage(browser, 'CLIENT_REVIEWER', seed);
  const finishErrors = watchPageErrors(page, label);

  await page.goto(BASE + '/profile-review');

  // The active review renders with its isolated sandbox inputs.
  const rpi = page.getByTestId('input-sandbox-rpi');
  await waitFor(() => rpi.isVisible().catch(() => false), `${label}: sandbox RPI input visible`);
  check(await rpi.isEditable(), `${label}: isolated sandbox RPI input is editable`);

  // Edit isolated RPI/timeout/tolerance and the expected-response override.
  await rpi.fill('500');
  await page.getByTestId('input-sandbox-timeout').fill('1000');
  await page.getByTestId('input-sandbox-tolerance').fill('250');
  await page.getByTestId('input-sandbox-expected-response').fill('Acknowledged within tolerance');

  // Save sandbox — sends the private document via PUT /sandbox.
  const saveSandbox = page.getByTestId('button-save-client-sandbox');
  await waitFor(async () => await saveSandbox.isEnabled().catch(() => false), `${label}: SAVE SANDBOX enabled after edits`);
  await saveSandbox.click();
  await waitFor(async () => {
    const log = await requestLog(page);
    return log.some((r) => r.method === 'PUT' && r.path.endsWith('/sandbox'));
  }, `${label}: SAVE SANDBOX issues a PUT /sandbox`);

  let log = await requestLog(page);
  const sandboxPut = log.filter((r) => r.method === 'PUT' && r.path.endsWith('/sandbox')).pop();
  check(!!sandboxPut, `${label}: a PUT /sandbox request was sent`);
  check(
    sandboxPut?.body?.document?.timing?.requestedPacketIntervalMs === 500,
    `${label}: private sandbox document carries the isolated RPI (500), got ${sandboxPut?.body?.document?.timing?.requestedPacketIntervalMs}`,
  );
  check(
    sandboxPut?.body?.reviewId === seed.REVIEW_ID,
    `${label}: sandbox save is bound to immutable review ${seed.REVIEW_ID}`,
  );
  check(
    sandboxPut?.body?.document?.fields?.some((f) => f.expectedReportedResponse === 'Acknowledged within tolerance'),
    `${label}: private sandbox document carries the expected-response override`,
  );

  // Run simulation — displays PASS and posts version-bound isolated evidence.
  await page.getByTestId('button-run-review-simulation').click();
  const verdict = page.getByTestId('text-simulation-verdict');
  await waitFor(() => verdict.isVisible().catch(() => false), `${label}: simulation verdict visible`);
  check((await verdict.textContent())?.trim() === 'PASS', `${label}: simulation displays PASS`);

  await waitFor(async () => {
    const l = await requestLog(page);
    return l.some((r) => r.method === 'POST' && /\/versions\/\d+\/simulation$/.test(r.path));
  }, `${label}: RUN SIMULATION posts simulation evidence`);
  log = await requestLog(page);
  const simPost = log.filter((r) => r.method === 'POST' && /\/versions\/\d+\/simulation$/.test(r.path)).pop();
  check(
    simPost?.path === `/api/profiles/versions/${seed.VERSION_ID}/simulation`,
    `${label}: evidence is bound to the immutable version ${seed.VERSION_ID} (got ${simPost?.path})`,
  );
  check(simPost?.body?.passed === true, `${label}: recorded simulation evidence is passed=true`);
  check(
    simPost?.body?.reviewId === seed.REVIEW_ID,
    `${label}: simulation request carries the authoritative review binding`,
  );
  check(
    simPost?.body?.evidence?.isolated === true && simPost?.body?.evidence?.source === 'client-review-sandbox',
    `${label}: evidence is marked isolated + client-review-sandbox`,
  );
  check(
    simPost?.body?.evidence?.versionId === seed.VERSION_ID && simPost?.body?.evidence?.reviewId === seed.REVIEW_ID,
    `${label}: evidence carries version/review binding`,
  );

  // Add a comment.
  await page.getByTestId('input-review-comment').fill('Timing envelope looks acceptable for development.');
  await page.getByRole('button', { name: 'POST COMMENT' }).click();
  await waitFor(async () => {
    const l = await requestLog(page);
    return l.some((r) => r.method === 'POST' && r.path.endsWith('/comments'));
  }, `${label}: POST COMMENT issues a request`);
  await waitFor(
    () => page.getByText('Timing envelope looks acceptable for development.').isVisible().catch(() => false),
    `${label}: added comment is visible`,
  );
  check(
    await page.getByText('Timing envelope looks acceptable for development.').isVisible(),
    `${label}: the posted comment is displayed`,
  );

  // Approve the decision.
  await page.getByRole('button', { name: 'APPROVE FOR PUBLICATION' }).click();
  await waitFor(async () => {
    const l = await requestLog(page);
    return l.some((r) => r.method === 'POST' && r.path.endsWith('/decision'));
  }, `${label}: APPROVE issues a decision request`);
  log = await requestLog(page);
  const decisionPost = log.filter((r) => r.method === 'POST' && r.path.endsWith('/decision')).pop();
  check(decisionPost?.body?.decision === 'ACCEPTED', `${label}: decision request sends ACCEPTED`);

  // Send real HTTP requests to a server-side fixture that imports the API's
  // centralized permission policy. These are not generated by the UI mock.
  const draftDenied = await context.request.put(
    `${DENIAL_BASE}/api/profiles/${seed.PROFILE_ID}/draft`,
    { data: { document: {} } },
  );
  check(
    draftDenied.status() === 403,
    `${label}: actual server policy denies shared-draft mutation (403), got ${draftDenied.status()}`,
  );
  check(
    (await draftDenied.json()).error === 'Forbidden',
    `${label}: shared-draft denial uses the production Forbidden contract`,
  );

  const auditDenied = await context.request.get(
    `${DENIAL_BASE}/api/profiles/${seed.PROFILE_ID}/audit`,
  );
  check(
    auditDenied.status() === 403,
    `${label}: actual server policy denies audit read (403), got ${auditDenied.status()}`,
  );
  check(
    (await auditDenied.json()).error === 'Forbidden',
    `${label}: audit denial uses the production Forbidden contract`,
  );

  finishErrors();
  await page.close();
  await context.close();
}

// ─── 3) SUPERADMIN /settings ──────────────────────────────────────────────────
async function superadminChecks(browser, seed) {
  const label = 'superadmin';
  const { context, page } = await newRolePage(browser, 'SUPERADMIN', seed);
  const finishErrors = watchPageErrors(page, label);

  await page.goto(BASE + '/settings');

  // User Management (role governance) card is visible.
  const userMgmt = page.getByText('User Management', { exact: true });
  await waitFor(() => userMgmt.isVisible().catch(() => false), `${label}: User Management card visible`);
  check(await userMgmt.isVisible(), `${label}: user-role governance card is visible`);

  // Governance audit history card is visible.
  const auditCard = page.getByTestId('card-governance-audit');
  await waitFor(() => auditCard.isVisible().catch(() => false), `${label}: governance audit card visible`);
  check(await auditCard.isVisible(), `${label}: governance audit history is visible`);
  check(
    await page.getByTestId('select-governance-audit-profile').isVisible(),
    `${label}: governance audit can be scoped by profile`,
  );

  // Wait for the accounts to load, then change the firmware-admin user to Client
  // Reviewer via the REVIEWER role toggle. Match the account row by the username
  // text and scope the click to that row's REVIEWER toggle.
  await waitFor(
    () => page.getByText('firmware-admin').first().isVisible().catch(() => false),
    `${label}: user accounts loaded`,
    15000,
  );

  // The firmware-admin row's REVIEWER toggle sends role=CLIENT_REVIEWER for user 11.
  // Each account renders as its own bordered row; pick the innermost such row
  // that contains the username so the REVIEWER toggle is unambiguous.
  const fwAdminRow = page
    .locator('div.border.bg-background\\/30')
    .filter({ has: page.getByText('firmware-admin') })
    .last();
  await fwAdminRow.getByRole('button', { name: 'REVIEWER' }).click();

  await waitFor(async () => {
    const log = await requestLog(page);
    return log.some((r) => r.method === 'PUT' && /\/admin\/users\/11$/.test(r.path));
  }, `${label}: role change issues a PUT /admin/users/11`);
  const log = await requestLog(page);
  const rolePut = log.filter((r) => r.method === 'PUT' && /\/admin\/users\/11$/.test(r.path)).pop();
  check(rolePut?.body?.role === 'CLIENT_REVIEWER', `${label}: role update sends role=CLIENT_REVIEWER (got ${rolePut?.body?.role})`);
  check(rolePut?.status === 200, `${label}: role update returned 200`);

  // Refresh the independently governed profile lifecycle audit.
  await page.getByTestId('button-refresh-governance-audit').click();

  // A real profile lifecycle audit action and its actor are visible. User-role
  // mutation history is not fabricated by this browser fixture.
  await waitFor(
    () => page.getByText('DEVELOPMENT_PUBLISHED', { exact: true }).isVisible().catch(() => false),
    `${label}: profile lifecycle audit action row appears`,
    12000,
  );
  const auditRow = auditCard.locator('[data-testid^="row-audit-"]', { hasText: 'DEVELOPMENT_PUBLISHED' }).first();
  check(await auditRow.isVisible(), `${label}: governed profile audit row is visible`);
  const auditRowText = await auditRow.textContent();
  check(auditRowText?.includes('DEVELOPMENT_PUBLISHED'), `${label}: audit row shows the lifecycle action`);
  check(auditRowText?.includes('firmware-admin') && auditRowText?.includes('FIRMWARE_ADMIN'), `${label}: audit row shows the responsible actor and role`);

  finishErrors();
  await page.close();
  await context.close();
}

async function main() {
  if (!EXECUTABLE) throw new Error('REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE is not set');
  const seed = { ...MOCK_SEED, document: buildProfileDocument() };
  let server;
  let denialServer;
  let browser;
  try {
    denialServer = await startDenialServer();
    server = await startServer();
    browser = await chromium.launch({
      executablePath: EXECUTABLE,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    // One fresh browser context per canonical role, run concurrently to stay
    // within the validation runner's time budget.
    await Promise.all([
      firmwareAdminChecks(browser, seed),
      clientReviewerChecks(browser, seed),
      superadminChecks(browser, seed),
    ]);
  } finally {
    await browser?.close();
    if (server) {
      try {
        process.kill(-server.pid, 'SIGTERM'); // kill the whole dev-server process group
      } catch {
        server.kill('SIGTERM');
      }
    }
    if (denialServer) {
      try {
        process.kill(-denialServer.pid, 'SIGTERM');
      } catch {
        denialServer.kill('SIGTERM');
      }
    }
  }
  console.log(`\n${checks} checks, ${failures.length} failures`);
  if (failures.length) {
    console.error(failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('Role workflows browser regression check PASSED');
  process.exit(0); // do not linger on surviving child handles
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
