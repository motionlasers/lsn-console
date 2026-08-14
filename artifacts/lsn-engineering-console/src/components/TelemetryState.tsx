import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Radio } from "lucide-react";
import { getTelemetryFreshness, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function formatTelemetryAge(ageMs: number | null): string {
  if (ageMs == null) return "NO VALID UPDATE";
  if (ageMs < 1_000) return "LESS THAN 1 SECOND AGO";
  return `${(ageMs / 1_000).toFixed(1)} SECONDS AGO`;
}

export function useTelemetryState() {
  const { connectionState, lastValidTelemetryAt } = useStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  return getTelemetryFreshness(connectionState, lastValidTelemetryAt, now);
}

export function TelemetryNotice({ compact = false }: { compact?: boolean }) {
  const telemetry = useTelemetryState();
  if (telemetry.isLive) return null;

  return (
    <div className={cn(
      "border border-warning/40 bg-warning/10 text-warning font-mono rounded-sm flex items-start gap-3",
      compact ? "px-3 py-2 text-[10px]" : "p-4 text-xs",
    )}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div>
        <div className="font-bold tracking-wider">LIVE TELEMETRY {telemetry.state}</div>
        <div className="text-muted-foreground mt-1">
          Values below are not current. Last valid update: {formatTelemetryAge(telemetry.ageMs)}.
        </div>
      </div>
    </div>
  );
}

export function TelemetryValue({
  children,
  lastReported,
  className,
}: {
  children: ReactNode;
  lastReported: ReactNode;
  className?: string;
}) {
  const telemetry = useTelemetryState();
  if (telemetry.isLive) return <>{children}</>;

  return (
    <div className={cn("flex flex-col items-end gap-0.5 font-mono", className)}>
      <span className="text-warning font-bold">UNKNOWN</span>
      <span className="text-[9px] text-muted-foreground">LAST REPORTED: {lastReported}</span>
    </div>
  );
}

export function LiveTelemetryBadge() {
  const telemetry = useTelemetryState();
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2 py-0.5 border rounded-sm text-[9px] font-mono font-bold tracking-wider",
      telemetry.isLive
        ? "border-success/30 bg-success/10 text-success"
        : "border-warning/30 bg-warning/10 text-warning",
    )}>
      <Radio className="w-3 h-3" />
      {telemetry.isLive ? "LIVE" : telemetry.state}
    </span>
  );
}