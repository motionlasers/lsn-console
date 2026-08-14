import { useStore } from "@/lib/store";
import { Link, useLocation } from "wouter";
import { 
  Activity, ActivityIcon, Cable, Cpu, FileJson, Info, LayoutDashboard, 
  ListTree, Network, PanelLeftClose, PanelLeftOpen, PlaySquare, Settings, ShieldAlert, Terminal, TestTube
} from "lucide-react";
import saberLogo from "@assets/Saber-Industrial-Applications-Logo_1786661980178.png";
import blsLogo from "@assets/Beyond-Laser-Systems-Logo-white.png";
import { cn } from "@/lib/utils";
import { useTourStore } from "@/hooks/use-tour";
import { TOUR_STEPS } from "@/lib/tour-data";
import { LiveTelemetryBadge } from "@/components/TelemetryState";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  const { mode, connectionState, settings, updateSettings } = useStore();
  const { isTourActive, currentStep } = useTourStore();
  const tourRoute = isTourActive ? TOUR_STEPS[currentStep]?.route : undefined;
  const selectedBrandLogo = settings.brandLogo ?? 'sia';
  const isBlsBrand = selectedBrandLogo === 'bls';
  const isCollapsed = settings.navCollapsed ?? false;

  return (
    <aside
      className={cn(
        "relative bg-sidebar border-r border-border h-full flex flex-col justify-between transition-[width] duration-200 ease-out shrink-0",
        isCollapsed ? "w-16" : "w-64",
      )}
      data-collapsed={isCollapsed ? "true" : "false"}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute z-20 -right-3 top-4 h-6 w-6 rounded-full bg-sidebar border-border text-muted-foreground hover:bg-primary/10 hover:text-primary"
        onClick={() => updateSettings({ navCollapsed: !isCollapsed })}
        aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
        aria-expanded={!isCollapsed}
        data-testid="button-toggle-navigation"
      >
        {isCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </Button>

      <div className={cn(
        "flex flex-col border-b border-border overflow-hidden transition-[padding] duration-200",
        isCollapsed ? "p-2 gap-0" : "p-4 gap-4",
      )}>
        <div className="w-full mb-2 flex justify-center">
          <img
            src={isBlsBrand ? blsLogo : saberLogo}
            alt={isBlsBrand ? "Beyond Laser Systems" : "Saber Industrial Applications"}
            className={cn(
              "block h-auto object-contain transition-[width,opacity] duration-200",
              isCollapsed ? "w-0 opacity-0" : "w-4/5 opacity-100",
            )}
            data-testid="nav-brand-logo"
          />
        </div>
        <div className={cn(
          "text-xs font-mono text-muted-foreground uppercase tracking-widest border border-border bg-background/50 rounded-sm overflow-hidden transition-[height,padding,opacity] duration-200",
          isCollapsed ? "h-0 p-0 opacity-0 border-transparent" : "h-auto p-2 opacity-100",
        )}>
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
        <nav className={cn("flex flex-col gap-1 px-2", isCollapsed && "items-center")}>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            const isTourTarget = isTourActive && item.path === tourRoute;
            const Icon = item.icon;
            const navLink = (
              <Link href={item.path} className={cn(
                "flex items-center py-2 text-sm font-mono transition-all rounded-sm",
                isCollapsed ? "w-10 justify-center px-0" : "w-full gap-3 px-3",
                isActive 
                  ? "bg-primary/10 text-primary border-l-2 border-primary" 
                  : "text-sidebar-foreground hover:bg-white/5 hover:text-white border-l-2 border-transparent",
                isTourTarget && "relative z-[110] bg-primary/20 text-primary border-primary shadow-[0_0_0_1px_hsl(var(--primary)),0_0_24px_hsl(var(--primary)/0.35)]"
              )}
              data-testid={`link-nav-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              data-tour-target={isTourTarget ? "true" : undefined}
              aria-label={isCollapsed ? item.label : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className={cn(isCollapsed && "sr-only")}>{item.label}</span>
              </Link>
            );

            return isCollapsed ? (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>{navLink}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            ) : (
              <div key={item.path} className="w-full">{navLink}</div>
            );
          })}
        </nav>
      </div>

    </aside>
  );
}
