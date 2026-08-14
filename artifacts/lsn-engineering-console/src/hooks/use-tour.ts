import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      nextStep: () => set((state) => ({ currentStep: state.currentStep + 1 })),
      prevStep: () => set((state) => ({ currentStep: Math.max(0, state.currentStep - 1) })),
      setStep: (step) => set({ currentStep: step }),
    }),
    {
      name: 'lsn-tour-preference-v1',
      partialize: (state) => ({ hasSeenTour: state.hasSeenTour }),
    }
  )
);
