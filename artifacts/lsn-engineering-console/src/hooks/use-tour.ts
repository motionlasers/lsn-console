import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TOUR_STEPS } from '@/lib/tour-data';

export interface TourState {
  hasSeenTour: boolean;
  isTourActive: boolean;
  currentStep: number;
  startTour: () => void;
  endTour: (dontShowAgain: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  setStep: (step: number) => void;
}

export const useTourStore = create<TourState>()(
  persist(
    (set) => ({
      hasSeenTour: false,
      isTourActive: false,
      currentStep: 0,
      startTour: () => set({ isTourActive: true, currentStep: 0 }),
      endTour: (dontShowAgain) => set({ isTourActive: false, hasSeenTour: dontShowAgain }),
      nextStep: () => set((state) => ({
        currentStep: Math.min(TOUR_STEPS.length - 1, state.currentStep + 1),
      })),
      prevStep: () => set((state) => ({ currentStep: Math.max(0, state.currentStep - 1) })),
      setStep: (step) => set({
        currentStep: Math.min(TOUR_STEPS.length - 1, Math.max(0, step)),
      }),
    }),
    {
      name: 'lsn-tour-preference-v1',
      partialize: (state) => ({ hasSeenTour: state.hasSeenTour }),
    }
  )
);
