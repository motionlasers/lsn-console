import { test, expect, beforeEach } from 'vitest';
import { useTourStore } from '../src/hooks/use-tour';

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
