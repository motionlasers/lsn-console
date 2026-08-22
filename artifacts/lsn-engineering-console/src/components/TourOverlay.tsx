import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useTourStore } from "@/hooks/use-tour";
import { useAuth } from "@/contexts/AuthContext";
import {
  getDetailStepsForRoute,
  getTourPageProgress,
  getTourStepsForRole,
  isTourStepAvailableForRole,
  TOUR_STEPS,
} from "@/lib/tour-data";
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

/** Render the phase label shown in the coachmark header bar. */
function PhaseLabel({ progress }: { progress: ReturnType<typeof getTourPageProgress> }) {
  if (progress.phase === "intro") {
    return (
      <span>
        INTRO · CONSOLE LAYOUT
      </span>
    );
  }
  if (progress.phase === "overview") {
    return (
      <span>
        OVERVIEW · STEP {progress.overviewIndex} OF {progress.overviewCount}
      </span>
    );
  }
  // detail
  return (
    <span>
      PAGE {progress.pageIndex}/{progress.pageCount} · {progress.page.toUpperCase()} · SECTION {progress.stepOnPage}/{progress.stepsOnPage}
    </span>
  );
}

function PageGuideLabel({
  page,
  position,
  count,
}: {
  page: string;
  position: number;
  count: number;
}) {
  return (
    <span>
      PAGE GUIDE · {page.toUpperCase()} · SECTION {position}/{count}
    </span>
  );
}

/** Build the live-region announcement text for a step. */
function buildAnnouncement(
  progress: ReturnType<typeof getTourPageProgress>,
  stepData: typeof TOUR_STEPS[number],
  targetMissing: boolean,
): string {
  const description = targetMissing
    ? (stepData.unavailableDescription ?? "This section is unavailable in the current mode or capability set.")
    : stepData.description;

  if (progress.phase === "intro") {
    return `Introduction, navigation overview. ${stepData.title}. ${description}`;
  }
  if (progress.phase === "overview") {
    return `Overview, step ${progress.overviewIndex} of ${progress.overviewCount}. ${stepData.title}. ${description}`;
  }
  return `${stepData.page}, section ${progress.stepOnPage} of ${progress.stepsOnPage}. ${stepData.title}. ${description}`;
}

export function TourOverlay() {
  const { user } = useAuth();
  const { isTourActive, currentStep, pageTourStart, endTour, setStep } = useTourStore();
  const [location, setLocation] = useLocation();
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [targetRect, setTargetRect] = useState<TourRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [coachmarkSize, setCoachmarkSize] = useState<TourSize>({ width: 440, height: 360 });
  const [reducedMotion, setReducedMotion] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const roleSteps = getTourStepsForRole(user?.role);
  const roleStepIndexes = roleSteps.map((step) => TOUR_STEPS.indexOf(step));
  const rawStepData = TOUR_STEPS[currentStep];
  const stepData = rawStepData && isTourStepAvailableForRole(rawStepData, user?.role)
    ? rawStepData
    : undefined;
  const rolePosition = stepData ? roleSteps.findIndex((step) => step.id === stepData.id) : -1;
  const isPageTour = pageTourStart !== null;
  const pageTourFirstStep = pageTourStart === null ? undefined : TOUR_STEPS[pageTourStart];
  const pageTourSteps = pageTourFirstStep
    ? getDetailStepsForRoute(pageTourFirstStep.route, user?.role)
    : [];
  const pageTourPosition = pageTourSteps.findIndex((step) => step.id === stepData?.id);
  const pageTourStepNumber = Math.max(0, pageTourPosition) + 1;
  const isLastStep = isPageTour
    ? pageTourPosition === pageTourSteps.length - 1
    : rolePosition === roleSteps.length - 1;
  const pageProgress = getTourPageProgress(currentStep);
  const overallStepNumber = Math.max(0, rolePosition) + 1;
  const finishTour = () => {
    if (isPageTour) {
      endTour(false);
      return;
    }
    setLocation("/downloads");
    endTour(dontShowAgain);
  };
  const goBack = () => {
    if (isPageTour && pageTourPosition <= 0) return;
    const previous = isPageTour
      ? TOUR_STEPS.indexOf(pageTourSteps[pageTourPosition - 1])
      : roleStepIndexes[rolePosition - 1];
    if (previous !== undefined && previous >= 0) setStep(previous);
  };
  const goForward = () => {
    if (isLastStep) {
      finishTour();
      return;
    }
    const next = isPageTour
      ? TOUR_STEPS.indexOf(pageTourSteps[pageTourPosition + 1])
      : roleStepIndexes[rolePosition + 1];
    if (next !== undefined && next >= 0) setStep(next);
  };

  useEffect(() => {
    if (!isTourActive || stepData || roleStepIndexes.length === 0) return;
    const nextAvailable = roleStepIndexes.find((index) => index >= currentStep)
      ?? roleStepIndexes[roleStepIndexes.length - 1];
    setStep(nextAvailable);
  }, [currentStep, isTourActive, roleStepIndexes, setStep, stepData]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (isTourActive && !isPageTour && stepData && location !== stepData.route) {
      setTargetRect(null);
      setTargetMissing(false);
      setLocation(stepData.route);
    }
  }, [isPageTour, isTourActive, location, setLocation, stepData]);

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

  // Stable refs so the keyboard effect doesn't re-register on every render.
  const goBackRef = useRef(goBack);
  const goForwardRef = useRef(goForward);
  goBackRef.current = goBack;
  goForwardRef.current = goForward;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTourActive) return;
      if (event.key === "Escape") {
        event.preventDefault();
        endTour(dontShowAgain);
        return;
      }
      // , / . shortcuts — skip if focus is inside a text input.
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const isTextInput = tag === "TEXTAREA" || (tag === "INPUT" && (document.activeElement as HTMLInputElement).type !== "checkbox");
      if (event.key === "," && !isTextInput) {
        event.preventDefault();
        goBackRef.current();
        return;
      }
      if (event.key === "." && !isTextInput) {
        event.preventDefault();
        goForwardRef.current();
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

  const rawPosition = targetRect
    ? computeTourPosition(targetRect, coachmarkSize, viewportSize(), stepData.preferredPlacement)
    : {
        x: Math.max(12, (window.innerWidth - coachmarkSize.width) / 2),
        y: Math.max(12, (window.innerHeight - coachmarkSize.height) / 2),
        placement: "bottom" as const,
      };

  // Secondary nav-avoidance pass: if the coachmark overlaps the active sidebar
  // nav item (aria-current="page"), push it down so it clears the link.  This
  // matters when the positioning engine clamps to the top-left corner because
  // the tour target fills most of the content area.
  const position = (() => {
    const navEl = document.querySelector<HTMLElement>('[aria-current="page"]');
    if (!navEl) return rawPosition;
    const nr = navEl.getBoundingClientRect();
    const dlgRight = rawPosition.x + coachmarkSize.width;
    const dlgBottom = rawPosition.y + coachmarkSize.height;
    const overlapsX = rawPosition.x < nr.right + 4 && dlgRight > nr.left - 4;
    const overlapsY = rawPosition.y < nr.bottom + 4 && dlgBottom > nr.top - 4;
    if (!overlapsX || !overlapsY) return rawPosition;
    const newY = Math.min(nr.bottom + 16, window.innerHeight - coachmarkSize.height - 12);
    // Skip the adjustment if it would push the coachmark back into the tour target.
    if (targetRect) {
      const newBottom = newY + coachmarkSize.height;
      const targetOverlapX = rawPosition.x < targetRect.right && dlgRight > targetRect.left;
      const targetOverlapY = newY < targetRect.bottom && newBottom > targetRect.top;
      if (targetOverlapX && targetOverlapY) return rawPosition;
    }
    return { ...rawPosition, y: newY };
  })();

  const announcement = buildAnnouncement(pageProgress, stepData, targetMissing);
  const isNarrowSidebarTarget =
    window.innerWidth <= 420 && stepData.target === "sidebar-nav";

  return (
    <div className="fixed inset-0 z-[100] pointer-events-auto" data-testid="tour-overlay">
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="tour-live-announcement">
        {announcement}
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
            "fixed z-[101] rounded-sm border-2 pointer-events-none tour-target-glow",
            !reducedMotion && "tour-target-stroke",
          )}
          style={{
            left: targetRect.left,
            top: targetRect.top,
            width: targetRect.width,
            height: targetRect.height,
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
          "fixed z-[102] max-h-[calc(100vh-1.5rem)] shadow-[0_0_40px_hsl(var(--tour-accent)/0.15)] border-tour-accent/40 bg-[#081217] text-foreground ring-1 ring-tour-accent/20 flex flex-col pointer-events-auto",
          isNarrowSidebarTarget
            ? "w-[calc(100vw-6rem)]"
            : "w-[min(440px,calc(100vw-1.5rem))]",
          !reducedMotion && stepData.target !== "help-reference" && "transition-[left,top] duration-200",
        )}
        style={{ left: position.x, top: position.y }}
      >
        <CardHeader className="pb-4 border-b border-border bg-black/20 relative shrink-0">
          <button
            type="button"
            aria-label="Close guided tour"
            data-testid="button-close-tour"
            onClick={() => endTour(dontShowAgain)}
            className="absolute top-4 right-4 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-tour-accent"
          >
            <X className="w-4 h-4" />
          </button>
          <div
            className="flex items-center gap-2 text-tour-accent text-[10px] font-mono tracking-widest font-bold mb-1 pr-8"
            data-testid="tour-phase-label"
          >
            <Info className="w-4 h-4 shrink-0" />
            {isPageTour ? (
              <PageGuideLabel
                page={stepData.page}
                position={pageTourStepNumber}
                count={pageTourSteps.length}
              />
            ) : (
              <PhaseLabel progress={pageProgress} />
            )}
          </div>
          <CardTitle id="tour-title" className="text-lg font-bold font-sans tracking-tight pr-6">
            {stepData.title}
          </CardTitle>
        </CardHeader>
        <CardContent id="tour-description" data-testid="text-tour-description" className="pt-5 pb-5 text-sm text-muted-foreground font-mono leading-relaxed flex-1 min-h-0 overflow-y-auto">
          <p>{targetMissing ? (stepData.unavailableDescription ?? `${stepData.description} This section is unavailable in the current mode or capability set.`) : stepData.description}</p>
          {!targetMissing && stepData.steps && stepData.steps.length > 0 && (
            <ol className="list-decimal ml-4 mt-3 space-y-1.5">
              {stepData.steps.map((item, i) => {
                const dashIndex = item.indexOf(" — ");
                return (
                  <li key={i}>
                    {dashIndex !== -1 ? (
                      <>
                        <strong>{item.slice(0, dashIndex)}</strong>
                        {item.slice(dashIndex)}
                      </>
                    ) : (
                      item
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {targetMissing && (
            <p className="mt-3 border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning" role="status">
              TARGET UNAVAILABLE · Showing page-level guidance safely.
            </p>
          )}
          <div className="mt-4 text-[10px] text-muted-foreground/70">
            {isPageTour
              ? `PAGE GUIDE STEP ${pageTourStepNumber} OF ${pageTourSteps.length}`
              : `OVERALL STEP ${overallStepNumber} OF ${roleSteps.length}`}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 border-t border-border bg-black/20 pt-4 pb-4 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            {!isPageTour && (
              <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="dont-show-tour"
                  checked={dontShowAgain}
                  onChange={(event) => setDontShowAgain(event.target.checked)}
                  data-testid="checkbox-dont-show-tour"
                  className="w-4 h-4 rounded-sm border border-tour-accent/50 bg-black/20 text-tour-accent focus:ring-tour-accent accent-tour-accent"
                />
                Don&apos;t show again
              </label>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="ghost" size="sm" onClick={() => endTour(dontShowAgain)} className="font-mono text-xs text-muted-foreground" data-testid="button-tour-skip">
                SKIP
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goBack}
                disabled={isPageTour ? pageTourPosition <= 0 : rolePosition <= 0}
                className="font-mono text-xs"
                data-testid="button-tour-back"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> BACK
              </Button>
              <Button
                size="sm"
                onClick={goForward}
                className="font-mono text-xs bg-tour-accent text-tour-accent-foreground hover:bg-tour-accent/90"
                data-testid={isLastStep ? "button-tour-finish" : "button-tour-next"}
              >
                {isLastStep ? (isPageTour ? "CLOSE" : "GO TO DOWNLOADS") : "NEXT"}
                {!isLastStep && <ChevronRight className="w-4 h-4 ml-1" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1 w-full text-[10px] font-mono text-muted-foreground/40 select-none" aria-hidden="true">
            <span>Use the comma and period hotkeys:</span>
            <span><kbd className="font-mono">,</kbd> (back)</span>
            <span>and</span>
            <span><kbd className="font-mono">.</kbd> (next)</span>
          </div>
          <div
            className="w-full h-1 bg-border/30 rounded-full overflow-hidden"
            role="progressbar"
            aria-label={`Guided tour progress, step ${isPageTour ? pageTourStepNumber : overallStepNumber} of ${isPageTour ? pageTourSteps.length : roleSteps.length}`}
            aria-valuemin={1}
            aria-valuemax={isPageTour ? pageTourSteps.length : roleSteps.length}
            aria-valuenow={isPageTour ? pageTourStepNumber : overallStepNumber}
          >
            <div
              className={cn("h-full bg-tour-accent", !reducedMotion && "transition-[width] duration-200")}
              style={{
                width: `${(
                  (isPageTour ? pageTourStepNumber / pageTourSteps.length : overallStepNumber / roleSteps.length)
                  * 100
                )}%`,
              }}
            />
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
