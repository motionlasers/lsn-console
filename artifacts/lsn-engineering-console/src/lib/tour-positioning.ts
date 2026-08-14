import type { TourPlacement } from "@/lib/tour-data";

export interface TourRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface TourSize {
  width: number;
  height: number;
}

export interface TourPosition {
  x: number;
  y: number;
  placement: TourPlacement;
}

export function isUsableTourTarget(rect: Pick<TourRect, "width" | "height"> | null): boolean {
  return !!rect && rect.width >= 4 && rect.height >= 4;
}

export function getTourScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

export function isTourRouteReady(location: string, stepRoute: string): boolean {
  return location === stepRoute;
}

const MARGIN = 12;
const GAP = 16;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function computeTourPosition(
  target: TourRect,
  coachmark: TourSize,
  viewport: TourSize,
  preferred: TourPlacement = "right",
): TourPosition {
  const candidates: Record<TourPlacement, { x: number; y: number; available: number }> = {
    top: {
      x: target.left + target.width / 2 - coachmark.width / 2,
      y: target.top - coachmark.height - GAP,
      available: target.top - MARGIN,
    },
    right: {
      x: target.right + GAP,
      y: target.top + target.height / 2 - coachmark.height / 2,
      available: viewport.width - target.right - MARGIN,
    },
    bottom: {
      x: target.left + target.width / 2 - coachmark.width / 2,
      y: target.bottom + GAP,
      available: viewport.height - target.bottom - MARGIN,
    },
    left: {
      x: target.left - coachmark.width - GAP,
      y: target.top + target.height / 2 - coachmark.height / 2,
      available: target.left - MARGIN,
    },
  };
  const required: Record<TourPlacement, number> = {
    top: coachmark.height + GAP,
    right: coachmark.width + GAP,
    bottom: coachmark.height + GAP,
    left: coachmark.width + GAP,
  };
  const order: TourPlacement[] = [
    preferred,
    ...(["right", "bottom", "left", "top"] as TourPlacement[]).filter(side => side !== preferred),
  ];
  const placement = order.find(side => candidates[side].available >= required[side])
    ?? order.reduce((best, side) => candidates[side].available > candidates[best].available ? side : best, order[0]);
  const candidate = candidates[placement];
  return {
    x: clamp(candidate.x, MARGIN, viewport.width - coachmark.width - MARGIN),
    y: clamp(candidate.y, MARGIN, viewport.height - coachmark.height - MARGIN),
    placement,
  };
}