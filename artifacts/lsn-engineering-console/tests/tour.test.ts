import { test, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useTourStore } from '../src/hooks/use-tour';
import { getTourPageProgress, TOUR_PAGE_COUNT, TOUR_STEPS } from '../src/lib/tour-data';
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

// Targets that live in layout components (not page files) and must be excluded
// from the per-page source file assertion.
const LAYOUT_TARGETS = new Set(['sidebar-nav']);

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
    const steps = TOUR_STEPS.filter(step => step.route === route);
    expect(steps.length, `${route} should have section-level guidance`).toBeGreaterThanOrEqual(2);
    const source = readFileSync(resolve(process.cwd(), 'src/pages', file), 'utf8');
    for (const step of steps) {
      if (LAYOUT_TARGETS.has(step.target)) continue;
      expect(source, `${step.target} should be a stable landmark in ${file}`).toContain(`data-tour="${step.target}"`);
      expect(step.description.length).toBeGreaterThan(60);
    }
  }
});

test('page progress reports local and overall page position', () => {
  const firstSettings = TOUR_STEPS.findIndex(step => step.route === '/settings');
  const progress = getTourPageProgress(firstSettings);
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
