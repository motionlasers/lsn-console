import { test, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useTourStore } from '../src/hooks/use-tour';
import {
  getTourPageProgress,
  OVERVIEW_NAV_PAGES,
  TOUR_OVERVIEW_COUNT,
  TOUR_PAGE_COUNT,
  TOUR_STEPS,
} from '../src/lib/tour-data';
import {
  computeTourPosition,
  getTourScrollBehavior,
  isTourRouteReady,
  isUsableTourTarget,
} from '../src/lib/tour-positioning';

const mockStorage: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
  length: 0,
  key: () => null,
};

beforeEach(() => {
  useTourStore.setState({
    hasSeenTour: false,
    isTourActive: false,
    currentStep: 0,
  });
  localStorage.clear();
});

test('Tour preference starts as false', () => {
  const state = useTourStore.getState();
  expect(state.hasSeenTour).toBe(false);
  expect(state.isTourActive).toBe(false);
});

test('startTour activates tour and resets step', () => {
  useTourStore.setState({ currentStep: 5 });
  useTourStore.getState().startTour();
  
  const state = useTourStore.getState();
  expect(state.isTourActive).toBe(true);
  expect(state.currentStep).toBe(0);
});

test('endTour updates preference correctly', () => {
  useTourStore.getState().startTour();
  useTourStore.getState().endTour(true);
  
  const state = useTourStore.getState();
  expect(state.isTourActive).toBe(false);
  expect(state.hasSeenTour).toBe(true);
});

test('nextStep and prevStep navigate correctly', () => {
  useTourStore.getState().startTour();
  useTourStore.getState().nextStep();
  
  expect(useTourStore.getState().currentStep).toBe(1);
  
  useTourStore.getState().prevStep();
  expect(useTourStore.getState().currentStep).toBe(0);
  
  useTourStore.getState().prevStep();
  expect(useTourStore.getState().currentStep).toBe(0); // Should not go below 0
});

test('tour navigation clamps both direct and sequential step changes', () => {
  useTourStore.getState().setStep(Number.MAX_SAFE_INTEGER);
  expect(useTourStore.getState().currentStep).toBe(TOUR_STEPS.length - 1);
  useTourStore.getState().nextStep();
  expect(useTourStore.getState().currentStep).toBe(TOUR_STEPS.length - 1);
  useTourStore.getState().setStep(-20);
  expect(useTourStore.getState().currentStep).toBe(0);
});

// ─── Opening sequence ordering ─────────────────────────────────────────────

test('tour opens with intro then overview then detail steps in that order', () => {
  const phases = TOUR_STEPS.map(s => s.phase ?? 'detail');
  // Find the phase transitions
  let lastPhase = phases[0];
  const transitions: string[] = [lastPhase];
  for (const phase of phases.slice(1)) {
    if (phase !== lastPhase) {
      transitions.push(phase);
      lastPhase = phase;
    }
  }
  // Must be exactly: intro → overview → detail (no re-ordering or interleaving)
  expect(transitions).toEqual(['intro', 'overview', 'detail']);
});

test('first step is the intro navigation overview', () => {
  expect(TOUR_STEPS[0].id).toBe('sidebar-nav');
  expect(TOUR_STEPS[0].phase).toBe('intro');
});

test('overview steps immediately follow the intro step', () => {
  const overviewStart = TOUR_STEPS.findIndex(s => s.phase === 'overview');
  expect(overviewStart).toBe(1);
});

test('first detail step is a Dashboard section', () => {
  const firstDetail = TOUR_STEPS.find(s => (s.phase ?? 'detail') === 'detail');
  expect(firstDetail?.page).toBe('Dashboard');
  expect(firstDetail?.route).toBe('/');
});

// ─── Overview completeness ─────────────────────────────────────────────────

test('all navigation pages are covered in the overview description text', () => {
  const overviewSteps = TOUR_STEPS.filter(s => s.phase === 'overview');
  expect(overviewSteps.length).toBe(TOUR_OVERVIEW_COUNT);
  expect(overviewSteps.length).toBeGreaterThanOrEqual(3);

  const combinedText = overviewSteps.map(s => s.description).join(' ');
  for (const page of OVERVIEW_NAV_PAGES) {
    // Match page name or an unambiguous prefix (e.g. "Device &" → "Device & Capabilities")
    const found = combinedText.includes(page) || combinedText.includes(page.split(' ')[0]);
    expect(found, `Navigation page "${page}" must be named in an overview step description`).toBe(true);
  }
});

test('overview steps have unique ids, unique targets, and sufficient description length', () => {
  const overviewSteps = TOUR_STEPS.filter(s => s.phase === 'overview');
  const ids = overviewSteps.map(s => s.id);
  const targets = overviewSteps.map(s => s.target);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(targets).size).toBe(targets.length);
  for (const step of overviewSteps) {
    expect(step.description.length, `${step.id} description must be >60 chars`).toBeGreaterThan(60);
  }
});

test('overview steps stay on the dashboard route so no route transition occurs', () => {
  const overviewSteps = TOUR_STEPS.filter(s => s.phase === 'overview');
  for (const step of overviewSteps) {
    expect(step.route, `overview step ${step.id} should stay on /`).toBe('/');
  }
});

// ─── Target uniqueness across all steps ────────────────────────────────────

// Targets that live in layout components (not page files) and must be excluded
// from the per-page source file assertion.
const LAYOUT_TARGETS = new Set([
  'sidebar-nav',
  'overview-nav-session',
  'overview-nav-monitoring',
  'overview-nav-analysis',
  'overview-nav-management',
  'overview-nav-support',
]);

test('detailed definitions cover every primary route with stable unique targets', () => {
  const routeFiles: Record<string, string> = {
    '/': 'dashboard.tsx',
    '/device': 'device.tsx',
    '/control': 'control.tsx',
    '/status': 'status.tsx',
    '/runtime': 'runtime.tsx',
    '/diagnostics': 'diagnostics.tsx',
    '/protocol': 'protocol.tsx',
    '/tests': 'tests.tsx',
    '/stress': 'stress.tsx',
    '/firmware': 'firmware.tsx',
    '/profile': 'profile.tsx',
    '/modules': 'modules.tsx',
    '/logs': 'logs.tsx',
    '/help': 'help.tsx',
    '/downloads': 'downloads.tsx',
    '/settings': 'settings.tsx',
  };
  expect(TOUR_PAGE_COUNT).toBe(Object.keys(routeFiles).length);
  expect(new Set(TOUR_STEPS.map(step => step.id)).size).toBe(TOUR_STEPS.length);
  expect(new Set(TOUR_STEPS.map(step => step.target)).size).toBe(TOUR_STEPS.length);

  for (const [route, file] of Object.entries(routeFiles)) {
    const detailSteps = TOUR_STEPS.filter(
      step => step.route === route && (step.phase ?? 'detail') === 'detail',
    );
    expect(detailSteps.length, `${route} should have section-level guidance`).toBeGreaterThanOrEqual(2);
    const source = readFileSync(resolve(process.cwd(), 'src/pages', file), 'utf8');
    for (const step of detailSteps) {
      if (LAYOUT_TARGETS.has(step.target)) continue;
      expect(source, `${step.target} should be a stable landmark in ${file}`).toContain(`data-tour="${step.target}"`);
      expect(step.description.length).toBeGreaterThan(60);
    }
  }
});

// ─── Phase-aware progress reporting ───────────────────────────────────────

test('intro step reports phase=intro', () => {
  const progress = getTourPageProgress(0);
  expect(progress.phase).toBe('intro');
  expect(progress.stepsOnPage).toBe(1);
});

test('overview steps report phase=overview with correct index', () => {
  const firstOverview = TOUR_STEPS.findIndex(s => s.phase === 'overview');
  const lastOverview = TOUR_STEPS.findLastIndex(s => s.phase === 'overview');

  const first = getTourPageProgress(firstOverview);
  expect(first.phase).toBe('overview');
  expect(first.overviewIndex).toBe(1);
  expect(first.overviewCount).toBe(TOUR_OVERVIEW_COUNT);

  const last = getTourPageProgress(lastOverview);
  expect(last.phase).toBe('overview');
  expect(last.overviewIndex).toBe(TOUR_OVERVIEW_COUNT);
});

test('page progress reports local and overall page position for detail steps', () => {
  const firstSettings = TOUR_STEPS.findIndex(
    step => step.route === '/settings' && (step.phase ?? 'detail') === 'detail',
  );
  const progress = getTourPageProgress(firstSettings);
  expect(progress.phase).toBe('detail');
  expect(progress.page).toBe('Settings');
  expect(progress.pageIndex).toBe(TOUR_PAGE_COUNT - 1);
  expect(progress.stepOnPage).toBe(1);
  expect(progress.stepsOnPage).toBeGreaterThanOrEqual(2);

  const finalProgress = getTourPageProgress(TOUR_STEPS.length - 1);
  expect(finalProgress.page).toBe('Downloads');
  expect(finalProgress.pageIndex).toBe(TOUR_PAGE_COUNT);
  expect(TOUR_STEPS.at(-1)?.route).toBe('/downloads');
  expect(TOUR_STEPS.at(-1)?.description).toContain("ready to begin firmware development");
});

// ─── Positioning and helpers ───────────────────────────────────────────────

test('positioning honors preferred sides when they fit and clamps to safe viewport bounds', () => {
  const viewport = { width: 1200, height: 800 };
  const coachmark = { width: 400, height: 300 };
  const centered = { left: 500, right: 700, top: 300, bottom: 500, width: 200, height: 200 };
  expect(computeTourPosition(centered, coachmark, viewport, 'right').placement).toBe('right');
  expect(computeTourPosition(centered, coachmark, viewport, 'left').placement).toBe('left');

  const edge = { left: 4, right: 180, top: 4, bottom: 120, width: 176, height: 116 };
  const result = computeTourPosition(edge, { width: 360, height: 260 }, { width: 390, height: 700 }, 'top');
  expect(result.x).toBeGreaterThanOrEqual(12);
  expect(result.y).toBeGreaterThanOrEqual(12);
  expect(result.x + 360).toBeLessThanOrEqual(378);
  expect(result.y + 260).toBeLessThanOrEqual(688);
});

test('route, conditional-target, and reduced-motion helpers enforce safe presentation', () => {
  expect(isTourRouteReady('/runtime', '/runtime')).toBe(true);
  expect(isTourRouteReady('/runtime', '/tests')).toBe(false);
  expect(isUsableTourTarget({ width: 300, height: 120 })).toBe(true);
  expect(isUsableTourTarget({ width: 0, height: 0 })).toBe(false);
  expect(isUsableTourTarget(null)).toBe(false);
  expect(getTourScrollBehavior(false)).toBe('smooth');
  expect(getTourScrollBehavior(true)).toBe('auto');
});
