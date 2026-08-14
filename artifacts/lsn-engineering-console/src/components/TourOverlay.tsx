import { useEffect, useState } from "react";
import { useTourStore } from "@/hooks/use-tour";
import { TOUR_STEPS } from "@/lib/tour-data";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, ChevronRight, ChevronLeft, X, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export function TourOverlay() {
  const { isTourActive, currentStep, endTour, nextStep, prevStep } = useTourStore();
  const [location, setLocation] = useLocation();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const stepData = TOUR_STEPS[currentStep];
  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  // Navigate to step route when step changes
  useEffect(() => {
    if (isTourActive && stepData) {
      if (location !== stepData.route) setLocation(stepData.route);
    }
  }, [isTourActive, currentStep, stepData, location, setLocation]);

  // Enforce tour priority over /help
  useEffect(() => {
    if (isTourActive && location === '/help' && stepData) {
      setLocation(stepData.route);
    }
  }, [isTourActive, location, stepData, setLocation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTourActive) {
        endTour(dontShowAgain);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTourActive, dontShowAgain, endTour]);

  if (!isTourActive || !stepData) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none bg-background/55 backdrop-blur-[2px]">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        data-testid="dialog-firmware-tour"
        className="w-[min(450px,calc(100vw-2rem))] shadow-2xl border-primary/50 bg-card pointer-events-auto flex flex-col animate-in fade-in zoom-in-95 duration-200"
      >
        <CardHeader className="pb-4 border-b border-border bg-black/20 relative">
          <button 
            data-testid="button-close-tour"
            onClick={() => endTour(dontShowAgain)}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 text-primary text-xs font-mono tracking-widest font-bold mb-1">
            <Info className="w-4 h-4" />
            STEP {currentStep + 1} OF {TOUR_STEPS.length}
          </div>
          <CardTitle id="tour-title" className="text-lg font-bold font-sans tracking-tight">
            {stepData.title}
          </CardTitle>
        </CardHeader>
        <CardContent id="tour-description" data-testid="text-tour-description" className="pt-6 pb-6 text-sm text-muted-foreground font-mono leading-relaxed min-h-[120px]">
          {stepData.description}
        </CardContent>
        <CardFooter className="flex flex-col gap-4 border-t border-border bg-black/20 pt-4 pb-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-2">
              <input 
                type="checkbox"
                id="dont-show-tour" 
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                data-testid="checkbox-dont-show-tour"
                className="w-4 h-4 rounded-sm border border-primary/50 bg-black/20 text-primary focus:ring-primary focus:ring-offset-0 checked:bg-primary accent-primary"
              />
              <label 
                htmlFor="dont-show-tour" 
                className="text-xs font-mono text-muted-foreground cursor-pointer select-none"
              >
                Don't show again
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => endTour(dontShowAgain)}
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-tour-skip"
              >
                SKIP TOUR
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={prevStep} 
                disabled={currentStep === 0}
                className="font-mono text-xs border-border/50 text-foreground hover:text-primary"
                data-testid="button-tour-back"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                BACK
              </Button>
              {isLastStep ? (
                <Button 
                  size="sm" 
                  onClick={() => {
                    endTour(dontShowAgain);
                    setLocation('/help');
                  }}
                  className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-tour-finish"
                >
                  OPEN GUIDE
                  <Play className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button 
                  size="sm" 
                  onClick={nextStep}
                  className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-tour-next"
                >
                  NEXT
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
          <div className="w-full flex gap-1 h-1" role="progressbar" aria-valuemin={1} aria-valuemax={TOUR_STEPS.length} aria-valuenow={currentStep + 1}>
            {TOUR_STEPS.map((_, i) => (
              <div 
                key={i} 
                className={cn(
                  "h-full flex-1 rounded-full transition-colors",
                  i === currentStep ? "bg-primary" : i < currentStep ? "bg-primary/30" : "bg-border/30"
                )} 
              />
            ))}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
