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

/**
 * Returns the overlap area (px²) between the coachmark rect [x,y,w,h] and the
 * target highlight rect. Zero means no overlap.
 */
function overlapArea(x: number, y: number, w: number, h: number, target: TourRect): number {
  const ox = Math.max(0, Math.min(x + w, target.right) - Math.max(x, target.left));
  const oy = Math.max(0, Math.min(y + h, target.bottom) - Math.max(y, target.top));
  return ox * oy;
}

/**
 * Clamp a coachmark position into the visible viewport while also trying to
 * keep it outside the highlighted target rectangle.
 *
 * Strategy for each axis independently:
 *   – Start with the raw candidate coordinates.
 *   – Clamp into the viewport.
 *   – If the clamped result still overlaps the target on that axis, try
 *     snapping to the nearest edge of the target that keeps it inside the
 *     viewport. Choose whichever snap produces less overlap.
 */
function clampAvoiding(
  rawX: number,
  rawY: number,
  w: number,
  h: number,
  target: TourRect,
  viewport: TourSize,
): { x: number; y: number } {
  // First: standard viewport clamp.
  let x = clamp(rawX, MARGIN, viewport.width - w - MARGIN);
  let y = clamp(rawY, MARGIN, viewport.height - h - MARGIN);

  // If no overlap after standard clamp, we're done.
  if (overlapArea(x, y, w, h, target) === 0) return { x, y };

  // --- Try to escape on the X axis ---
  const xSnapLeft = clamp(target.left - w - GAP, MARGIN, viewport.width - w - MARGIN);
  const xSnapRight = clamp(target.right + GAP, MARGIN, viewport.width - w - MARGIN);
  const overlapLeft = overlapArea(xSnapLeft, y, w, h, target);
  const overlapRight = overlapArea(xSnapRight, y, w, h, target);
  const bestX = overlapLeft <= overlapRight ? xSnapLeft : xSnapRight;

  // --- Try to escape on the Y axis ---
  const ySnapAbove = clamp(target.top - h - GAP, MARGIN, viewport.height - h - MARGIN);
  const ySnapBelow = clamp(target.bottom + GAP, MARGIN, viewport.height - h - MARGIN);
  const overlapAbove = overlapArea(x, ySnapAbove, w, h, target);
  const overlapBelow = overlapArea(x, ySnapBelow, w, h, target);
  const bestY = overlapAbove <= overlapBelow ? ySnapAbove : ySnapBelow;

  // Pick whichever axis escape produces less overlap.
  const overlapIfXEscape = overlapArea(bestX, y, w, h, target);
  const overlapIfYEscape = overlapArea(x, bestY, w, h, target);

  if (overlapIfXEscape === 0 && overlapIfYEscape === 0) {
    // Both axes work; prefer whichever keeps closer to the originally-intended side.
    return overlapIfXEscape <= overlapIfYEscape ? { x: bestX, y } : { x, y: bestY };
  }
  if (overlapIfXEscape === 0) return { x: bestX, y };
  if (overlapIfYEscape === 0) return { x, y: bestY };

  // Neither single-axis escape fully clears — try both axes together.
  const bothX = overlapLeft <= overlapRight ? xSnapLeft : xSnapRight;
  const bothY = overlapAbove <= overlapBelow ? ySnapAbove : ySnapBelow;
  const overlapBoth = overlapArea(bothX, bothY, w, h, target);
  if (overlapBoth === 0) return { x: bothX, y: bothY };

  // Last resort: pick whichever of the four corner+edge combos has least overlap.
  const options = [
    { x: xSnapLeft, y: ySnapAbove },
    { x: xSnapRight, y: ySnapAbove },
    { x: xSnapLeft, y: ySnapBelow },
    { x: xSnapRight, y: ySnapBelow },
    { x: bestX, y },
    { x, y: bestY },
    { x, y },
  ];
  return options.reduce((best, opt) => {
    const o = overlapArea(opt.x, opt.y, w, h, target);
    const b = overlapArea(best.x, best.y, w, h, target);
    return o < b ? opt : best;
  });
}

export function computeTourPosition(
  target: TourRect,
  coachmark: TourSize,
  viewport: TourSize,
  preferred: TourPlacement = "right",
): TourPosition {
  const w = coachmark.width;
  const h = coachmark.height;

  // Raw (unclamped) origin for each side.
  const candidates: Record<TourPlacement, { x: number; y: number; available: number }> = {
    top: {
      x: target.left + target.width / 2 - w / 2,
      y: target.top - h - GAP,
      available: target.top - MARGIN,
    },
    right: {
      x: target.right + GAP,
      y: target.top + target.height / 2 - h / 2,
      available: viewport.width - target.right - MARGIN,
    },
    bottom: {
      x: target.left + target.width / 2 - w / 2,
      y: target.bottom + GAP,
      available: viewport.height - target.bottom - MARGIN,
    },
    left: {
      x: target.left - w - GAP,
      y: target.top + target.height / 2 - h / 2,
      available: target.left - MARGIN,
    },
  };
  const required: Record<TourPlacement, number> = {
    top: h + GAP,
    right: w + GAP,
    bottom: h + GAP,
    left: w + GAP,
  };

  const order: TourPlacement[] = [
    preferred,
    ...(["right", "bottom", "left", "top"] as TourPlacement[]).filter(s => s !== preferred),
  ];

  // Pick the side with enough clear space; fall back to the side with most space.
  const placement =
    order.find(side => candidates[side].available >= required[side]) ??
    order.reduce(
      (best, side) => (candidates[side].available > candidates[best].available ? side : best),
      order[0],
    );

  const { x: rawX, y: rawY } = candidates[placement];

  // Clamp to viewport, then escape the target rect.
  const { x, y } = clampAvoiding(rawX, rawY, w, h, target, viewport);

  return { x, y, placement };
}
