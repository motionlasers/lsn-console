import { useStore } from "@/lib/store";
import { Link, useLocation } from "wouter";
import { 
  Activity, ActivityIcon, Cable, Cpu, FileJson, Info, LayoutDashboard, 
  ListTree, Network, PlaySquare, Settings, ShieldAlert, Terminal, TestTube
} from "lucide-react";
import saberLogo from "@assets/Saber-Industrial-Applications-Logo_1786661980178.png";
import { cn } from "@/lib/utils";
import { useTourStore } from "@/hooks/use-tour";
import { TOUR_STEPS } from "@/lib/tour-data";
import { LiveTelemetryBadge } from "@/components/TelemetryState";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/device", label: "Device & Cap", icon: Cpu },
  { path: "/control", label: "Control", icon: PlaySquare },
  { path: "/status", label: "Status", icon: Activity },
  { path: "/runtime", label: "Runtime", icon: ActivityIcon },
  { path: "/diagnostics", label: "Diagnostics", icon: ShieldAlert },
  { path: "/protocol", label: "Protocol", icon: Network },
  { path: "/tests", label: "Tests", icon: TestTube },
  { path: "/stress", label: "Stress", icon: Cable },
  { path: "/firmware", label: "Firmware", icon: ListTree },
  { path: "/profile", label: "Profile", icon: FileJson },
  { path: "/modules", label: "Modules", icon: Settings },
  { path: "/logs", label: "Logs", icon: Terminal },
  { path: "/help", label: "Help", icon: Info },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();
  const { mode, connectionState } = useStore();
  const { isTourActive, currentStep } = useTourStore();
  const tourRoute = isTourActive ? TOUR_STEPS[currentStep]?.route : undefined;

  return (
    <div className="w-64 bg-sidebar border-r border-border h-full flex flex-col justify-between">
      <div className="p-4 flex flex-col gap-4 border-b border-border">
        <div className="w-full mb-2 flex justify-center">
          <img
            src={saberLogo}
            alt="Saber Industrial Applications"
            className="block w-4/5 h-auto object-contain"
          />
        </div>
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest border border-border p-2 bg-background/50 rounded-sm">
          <div className="flex justify-between items-center mb-1">
            <span>MODE:</span>
            <span className={cn(
              "font-bold",
              mode === 'simulation' ? "text-primary" : "text-destructive"
            )}>
              {mode.toUpperCase()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>LINK:</span>
            <span className={cn(
              "font-bold",
              connectionState === 'connected' ? "text-success" : 
              connectionState === 'faulted' ? "text-destructive" :
              connectionState === 'connecting' ? "text-warning animate-pulse" :
              "text-muted-foreground"
            )}>
              {connectionState.toUpperCase()}
            </span>
          </div>
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-border/50">
            <span>DATA:</span>
            <LiveTelemetryBadge />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        <nav className="flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            const isTourTarget = isTourActive && item.path === tourRoute;
            const Icon = item.icon;
            return (
              <Link key={item.path} href={item.path} className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm font-mono transition-all rounded-sm",
                isActive 
                  ? "bg-primary/10 text-primary border-l-2 border-primary" 
                  : "text-sidebar-foreground hover:bg-white/5 hover:text-white border-l-2 border-transparent",
                isTourTarget && "relative z-[110] bg-primary/20 text-primary border-primary shadow-[0_0_0_1px_hsl(var(--primary)),0_0_24px_hsl(var(--primary)/0.35)]"
              )}
              data-testid={`link-nav-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              data-tour-target={isTourTarget ? "true" : undefined}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

    </div>
  );
}
