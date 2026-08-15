import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useTourStore } from "@/hooks/use-tour";
import { getDetailStepsForRoute, hasPageTour, TOUR_STEPS } from "@/lib/tour-data";

export function PageTourButton() {
  const { user } = useAuth();
  const { isTourActive, startPageTour } = useTourStore();
  const [location] = useLocation();

  if (!user?.isAdmin || isTourActive || !hasPageTour(location)) return null;

  const firstStep = getDetailStepsForRoute(location)[0];
  const firstStepIndex = TOUR_STEPS.indexOf(firstStep);
  if (firstStepIndex < 0) return null;

  return (
    <button
      type="button"
      aria-label="Open page guide"
      data-testid="button-page-tour"
      onClick={() => startPageTour(firstStepIndex)}
      className="fixed bottom-5 right-5 z-[90] flex h-10 w-10 items-center justify-center rounded-full bg-tour-accent text-tour-accent-foreground font-mono text-lg font-bold shadow-lg transition-transform hover:scale-105 hover:bg-tour-accent/90 focus:outline-none focus:ring-2 focus:ring-tour-accent focus:ring-offset-2 focus:ring-offset-background"
    >
      ?
    </button>
  );
}