import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useTourStore } from "@/hooks/use-tour";
import { getDetailStepsForRoute, hasPageTour, TOUR_STEPS } from "@/lib/tour-data";

export function PageTourButton() {
  const { user } = useAuth();
  const { isTourActive, startPageTour } = useTourStore();
  const [location] = useLocation();

  if (!user || isTourActive || !hasPageTour(location, user.role)) return null;

  const firstStep = getDetailStepsForRoute(location, user.role)[0];
  const firstStepIndex = TOUR_STEPS.indexOf(firstStep);
  if (firstStepIndex < 0) return null;

  return (
    <button
      type="button"
      aria-label="Open page guide"
      data-testid="button-page-tour"
      onClick={() => startPageTour(firstStepIndex)}
      className="fixed bottom-5 right-5 z-[90] flex h-10 w-10 items-center justify-center rounded-full border-2 border-tour-accent bg-background/60 text-tour-accent font-mono text-lg font-bold backdrop-blur transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-tour-accent focus:ring-offset-2 focus:ring-offset-background"
      style={{ boxShadow: '0 0 12px hsl(192 90% 55% / 0.55), 0 0 4px hsl(192 90% 55% / 0.3)' }}
    >
      ?
    </button>
  );
}