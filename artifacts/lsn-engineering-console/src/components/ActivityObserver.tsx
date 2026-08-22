import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { activityApi, generateEventId } from "@/lib/activity-api";
import { useTourStore } from "@/hooks/use-tour";

export function ActivityObserver() {
  const [location] = useLocation();
  const { user, authenticated } = useAuth();
  const lastPath = useRef<string | null>(null);
  const { isTourActive } = useTourStore();

  useEffect(() => {
    // Only track if authenticated, user is an admin, and tour is not active
    if (!authenticated || !user) return;
    if (user.role !== 'SUPERADMIN' && user.role !== 'FIRMWARE_ADMIN') return;
    if (isTourActive) return;

    // Remove query/hash if any exist in the location string
    const normalizedPath = location.split('?')[0].split('#')[0];
    
    // Do not record login screen, and dedupe rerenders
    if (normalizedPath === '/login' || lastPath.current === normalizedPath) return;
    
    lastPath.current = normalizedPath;
    
    activityApi.recordEvent({
      eventName: 'PAGE_VISIT',
      clientEventId: generateEventId(),
      targetType: 'ROUTE',
      targetId: normalizedPath,
      targetLabel: normalizedPath,
    });
  }, [location, user, authenticated, isTourActive]);

  return null;
}
