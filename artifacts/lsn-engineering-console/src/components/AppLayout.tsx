import { type ReactNode, useEffect, useRef } from "react";
import { Sidebar } from "@/components/Sidebar";
import { useStore } from "@/lib/store";
import { ShieldAlert, LogOut, User } from "lucide-react";
import { useTourStore } from "@/hooks/use-tour";
import { TourOverlay } from "@/components/TourOverlay";
import lsnLogo from "@assets/LSN-Industrial-transparent_1786661922957.png";
import { LiveTelemetryBadge, useTelemetryState } from "@/components/TelemetryState";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { CONSOLE_RELEASE_LABEL } from "@/lib/release";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";

export function AppLayout({ children }: { children: ReactNode }) {
  const { logicalState, hardwareUnlocked, mode, tick, settings } = useStore();
  const telemetry = useTelemetryState();
  const { hasSeenTour, isTourActive, startTour } = useTourStore();
  const { user, logout } = useAuth();
  const tourMounted = useRef(false);
  const applicationShellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      tick(settings.simulatorTiming);
    }, Math.max(10, settings.simulatorTiming));
    return () => window.clearInterval(interval);
  }, [settings.simulatorTiming, tick]);

  useEffect(() => {
    if (!tourMounted.current) {
      tourMounted.current = true;
      if (!hasSeenTour && !isTourActive) {
        const t = setTimeout(() => startTour(), 500);
        return () => clearTimeout(t);
      }
    }
    return undefined;
  }, [hasSeenTour, isTourActive, startTour]);

  useEffect(() => {
    const shell = applicationShellRef.current;
    if (!shell) return;
    shell.inert = isTourActive;
    if (isTourActive) shell.setAttribute("aria-hidden", "true");
    else shell.removeAttribute("aria-hidden");
    return () => {
      shell.inert = false;
      shell.removeAttribute("aria-hidden");
    };
  }, [isTourActive]);

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      <div ref={applicationShellRef} className="flex h-full w-full">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="h-12 border-b border-border bg-card flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold tracking-wider uppercase text-foreground/80 font-mono">
              LSN Engineering Console {CONSOLE_RELEASE_LABEL}
            </h1>
            {mode === 'hardware' && hardwareUnlocked && (
               <span className="bg-destructive/20 text-destructive border border-destructive/30 px-2 py-0.5 rounded-sm text-[10px] font-mono tracking-widest animate-pulse">
                  BENCH ACKNOWLEDGED / TRANSPORT LOCKED
               </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <LiveTelemetryBadge />
            {telemetry.isLive && logicalState.faulted && (
              <div className="flex items-center gap-2 text-destructive bg-destructive/10 px-3 py-1 rounded-sm border border-destructive/20 animate-pulse">
                <ShieldAlert className="w-4 h-4" />
                <span>FAULT: {logicalState.faultCode}</span>
              </div>
            )}
            {telemetry.isLive && !logicalState.faulted && logicalState.emissionControlOutputActive && (
              <div className="flex items-center gap-2 text-primary bg-primary/10 px-3 py-1 rounded-sm border border-primary/20">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span>EMISSION CONTROL OUTPUT ACTIVE</span>
              </div>
            )}
            {/* User identity + logout */}
            {user && (
              <div className="flex items-center gap-2 border-l border-border/50 pl-3">
                <User className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground text-[11px] font-mono tracking-wider">
                  {user.username}
                  {user.isAdmin && (
                    <span className="ml-1 text-amber-500/70">[ADMIN]</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={handleLogout}
                  title="Sign out"
                  aria-label="Sign out"
                  data-testid="button-logout"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
        
        {/* Fixed workspace watermark and independently scrolling content */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
            <img
              src={lsnLogo}
              alt=""
              className="absolute w-[clamp(34rem,58vw,52rem)] max-w-none h-auto opacity-[0.025] right-[-6%] bottom-[-16%] select-none"
            />
          </div>
          <main id="main-workspace" tabIndex={-1} className="h-full overflow-auto p-6 relative z-10">
            <div className="absolute inset-0 pointer-events-none opacity-[0.02] mix-blend-overlay z-0" 
                 style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}>
            </div>
            <div className="max-w-6xl mx-auto h-full relative z-10 flex flex-col gap-6">
              {children}
            </div>
          </main>
        </div>
        </div>
      </div>
      <TourOverlay />
      <WhatsNewDialog />
    </div>
  );
}
