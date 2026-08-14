import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useTourStore } from "@/hooks/use-tour";
import { getTourPageProgress, TOUR_STEPS } from "@/lib/tour-data";
import {
  computeTourPosition,
  getTourScrollBehavior,
  isTourRouteReady,
  isUsableTourTarget,
  type TourRect,
  type TourSize,
} from "@/lib/tour-positioning";
import { cn } from "@/lib/utils";

const TARGET_PADDING = 8;

function viewportSize(): TourSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

function paddedRect(rect: DOMRect): TourRect {
  const left = Math.max(4, rect.left - TARGET_PADDING);
  const top = Math.max(4, rect.top - TARGET_PADDING);
  const right = Math.min(window.innerWidth - 4, rect.right + TARGET_PADDING);
  const bottom = Math.min(window.innerHeight - 4, rect.bottom + TARGET_PADDING);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function TourOverlay() {
  const { isTourActive, currentStep, endTour, nextStep, prevStep } = useTourStore();
  const [location, setLocation] = useLocation();
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [targetRect, setTargetRect] = useState<TourRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [coachmarkSize, setCoachmarkSize] = useState<TourSize>({ width: 440, height: 360 });
  const [reducedMotion, setReducedMotion] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const stepData = TOUR_STEPS[currentStep];
  const isLastStep = currentStep === TOUR_STEPS.length - 1;
  const pageProgress = getTourPageProgress(currentStep);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (isTourActive && stepData && location !== stepData.route) {
      setTargetRect(null);
      setTargetMissing(false);
      setLocation(stepData.route);
    }
  }, [isTourActive, location, setLocation, stepData]);

  useEffect(() => {
    if (!isTourActive) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      targetRef.current?.removeAttribute("data-tour-active");
      window.setTimeout(() => {
        const previous = previousFocusRef.current;
        const fallback = document.querySelector<HTMLElement>('[aria-current="page"]')
          ?? document.querySelector<HTMLElement>("#main-workspace");
        const restoreTarget = previous?.isConnected && previous !== document.body ? previous : fallback;
        restoreTarget?.focus({ preventScroll: true });
      }, 0);
    };
  }, [isTourActive]);

  useEffect(() => {
    if (!isTourActive || !stepData || !isTourRouteReady(location, stepData.route)) return;
    let cancelled = false;
    let attempts = 0;
    let observer: ResizeObserver | null = null;
    let settleTimer = 0;
    const updateGeometry = () => {
      if (targetRef.current?.isConnected) setTargetRect(paddedRect(targetRef.current.getBoundingClientRect()));
    };
    const onViewportChange = () => window.requestAnimationFrame(updateGeometry);
    const findTarget = () => {
      if (cancelled) return;
      const target = document.querySelector<HTMLElement>(`[data-tour="${stepData.target}"]`);
      if (!target && attempts++ < 16) {
        settleTimer = window.setTimeout(findTarget, 50);
        return;
      }
      if (!target) {
        setTargetMissing(true);
        setTargetRect(null);
        window.setTimeout(() => cardRef.current?.focus(), 0);
        return;
      }
      const initialRect = target.getBoundingClientRect();
      if (!isUsableTourTarget(initialRect)) {
        setTargetMissing(true);
        setTargetRect(null);
        window.setTimeout(() => cardRef.current?.focus(), 0);
        return;
      }
      targetRef.current?.removeAttribute("data-tour-active");
      targetRef.current = target;
      target.setAttribute("data-tour-active", "true");
      setTargetMissing(false);
      target.scrollIntoView({
        behavior: getTourScrollBehavior(reducedMotion),
        block: "center",
        inline: "nearest",
      });
      settleTimer = window.setTimeout(() => {
        updateGeometry();
        cardRef.current?.focus();
      }, reducedMotion ? 20 : 320);
      observer = new ResizeObserver(updateGeometry);
      observer.observe(target);
      window.addEventListener("resize", onViewportChange);
      window.addEventListener("scroll", onViewportChange, true);
    };
    findTarget();
    return () => {
      cancelled = true;
      window.clearTimeout(settleTimer);
      observer?.disconnect();
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      targetRef.current?.removeAttribute("data-tour-active");
      targetRef.current = null;
    };
  }, [currentStep, isTourActive, location, reducedMotion, stepData]);

  useLayoutEffect(() => {
    if (!cardRef.current || !isTourActive) return;
    const update = () => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect) setCoachmarkSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [currentStep, isTourActive, targetMissing]);

  useLayoutEffect(() => {
    if (isTourActive) cardRef.current?.focus({ preventScroll: true });
  }, [currentStep, isTourActive]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTourActive) return;
      if (event.key === "Escape") {
        event.preventDefault();
        endTour(dontShowAgain);
        return;
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!cardRef.current.contains(document.activeElement) || document.activeElement === cardRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dontShowAgain, endTour, isTourActive]);

  if (!isTourActive || !stepData) return null;

  const position = targetRect
    ? computeTourPosition(targetRect, coachmarkSize, viewportSize(), stepData.preferredPlacement)
    : {
        x: Math.max(12, (window.innerWidth - coachmarkSize.width) / 2),
        y: Math.max(12, (window.innerHeight - coachmarkSize.height) / 2),
        placement: "bottom" as const,
      };

  return (
    <div className="fixed inset-0 z-[100] pointer-events-auto" data-testid="tour-overlay">
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="tour-live-announcement">
        {`${stepData.page}, section ${pageProgress.stepOnPage} of ${pageProgress.stepsOnPage}. ${stepData.title}. ${targetMissing ? (stepData.unavailableDescription ?? "This section is unavailable in the current mode or capability set.") : stepData.description}`}
      </div>
      {targetRect ? (
        <div aria-hidden="true">
          <div className="fixed z-[100] bg-black/60" style={{ left: 0, top: 0, right: 0, height: targetRect.top }} />
          <div className="fixed z-[100] bg-black/60" style={{ left: 0, top: targetRect.top, width: targetRect.left, height: targetRect.height }} />
          <div className="fixed z-[100] bg-black/60" style={{ left: targetRect.right, top: targetRect.top, right: 0, height: targetRect.height }} />
          <div className="fixed z-[100] bg-black/60" style={{ left: 0, top: targetRect.bottom, right: 0, bottom: 0 }} />
        </div>
      ) : (
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      )}
      {targetRect && (
        <div
          className={cn(
            "fixed z-[101] rounded-sm border-2 border-primary pointer-events-none",
            !reducedMotion && "tour-target-stroke",
          )}
          style={{
            left: targetRect.left,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: "0 0 12px hsl(var(--primary) / 0.45)",
          }}
          data-testid="tour-target-highlight"
          aria-hidden="true"
        />
      )}
      <Card
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        data-testid="dialog-firmware-tour"
        data-placement={position.placement}
        className={cn(
          "fixed z-[102] w-[min(440px,calc(100vw-1.5rem))] max-h-[calc(100vh-1.5rem)] overflow-auto shadow-2xl border-primary/60 bg-card flex flex-col pointer-events-auto",
          !reducedMotion && "transition-[left,top] duration-200",
        )}
        style={{ left: position.x, top: position.y }}
      >
        <CardHeader className="pb-4 border-b border-border bg-black/20 relative">
          <button
            type="button"
            aria-label="Close guided tour"
            data-testid="button-close-tour"
            onClick={() => endTour(dontShowAgain)}
            className="absolute top-4 right-4 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 text-primary text-[10px] font-mono tracking-widest font-bold mb-1 pr-8">
            <Info className="w-4 h-4 shrink-0" />
            PAGE {pageProgress.pageIndex}/{pageProgress.pageCount} · {pageProgress.page.toUpperCase()} · SECTION {pageProgress.stepOnPage}/{pageProgress.stepsOnPage}
          </div>
          <CardTitle id="tour-title" className="text-lg font-bold font-sans tracking-tight pr-6">
            {stepData.title}
          </CardTitle>
        </CardHeader>
        <CardContent id="tour-description" data-testid="text-tour-description" className="pt-5 pb-5 text-sm text-muted-foreground font-mono leading-relaxed">
          <p>{targetMissing ? (stepData.unavailableDescription ?? `${stepData.description} This section is unavailable in the current mode or capability set.`) : stepData.description}</p>
          {targetMissing && (
            <p className="mt-3 border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning" role="status">
              TARGET UNAVAILABLE · Showing page-level guidance safely.
            </p>
          )}
          <div className="mt-4 text-[10px] text-muted-foreground/70">
            OVERALL STEP {currentStep + 1} OF {TOUR_STEPS.length}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4 border-t border-border bg-black/20 pt-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                id="dont-show-tour"
                checked={dontShowAgain}
                onChange={(event) => setDontShowAgain(event.target.checked)}
                data-testid="checkbox-dont-show-tour"
                className="w-4 h-4 rounded-sm border border-primary/50 bg-black/20 text-primary focus:ring-primary accent-primary"
              />
              Don&apos;t show again
            </label>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="ghost" size="sm" onClick={() => endTour(dontShowAgain)} className="font-mono text-xs text-muted-foreground" data-testid="button-tour-skip">
                SKIP
              </Button>
              <Button variant="outline" size="sm" onClick={prevStep} disabled={currentStep === 0} className="font-mono text-xs" data-testid="button-tour-back">
                <ChevronLeft className="w-4 h-4 mr-1" /> BACK
              </Button>
              <Button
                size="sm"
                onClick={() => isLastStep ? endTour(dontShowAgain) : nextStep()}
                className="font-mono text-xs bg-primary text-primary-foreground"
                data-testid={isLastStep ? "button-tour-finish" : "button-tour-next"}
              >
                {isLastStep ? "FINISH" : "NEXT"}
                {!isLastStep && <ChevronRight className="w-4 h-4 ml-1" />}
              </Button>
            </div>
          </div>
          <div
            className="w-full h-1 bg-border/30 rounded-full overflow-hidden"
            role="progressbar"
            aria-label={`Guided tour progress, step ${currentStep + 1} of ${TOUR_STEPS.length}`}
            aria-valuemin={1}
            aria-valuemax={TOUR_STEPS.length}
            aria-valuenow={currentStep + 1}
          >
            <div
              className={cn("h-full bg-primary", !reducedMotion && "transition-[width] duration-200")}
              style={{ width: `${((currentStep + 1) / TOUR_STEPS.length) * 100}%` }}
            />
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}