import { useStore, visibleLogicalState } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { TelemetryNotice, useTelemetryState } from "@/components/TelemetryState";

export default function StatusFields() {
  const { logicalState, capabilities } = useStore();
  const telemetry = useTelemetryState();
  
  const displayState = visibleLogicalState(logicalState, capabilities);

  return (
    <Card data-tour="status-overview" className="border-border bg-card/50 backdrop-blur">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Comprehensive Logical Status
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="mb-4"><TelemetryNotice /></div>
        <div data-tour="status-fields" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs">
          {Object.entries(displayState).map(([key, value]) => (
            <div key={key} className="border border-border/50 bg-black/20 p-3 rounded-sm flex flex-col justify-between">
              <span className="text-muted-foreground mb-2 break-all">{key}</span>
              <span className={`font-bold ${!telemetry.isLive ? 'text-warning' : typeof value === 'boolean' ? (value ? 'text-success' : 'text-muted-foreground') : 'text-primary'}`}>
                {telemetry.isLive ? (value === null ? 'NULL' : value === undefined ? 'UNDEFINED' : value.toString().toUpperCase()) : 'UNKNOWN'}
              </span>
              {!telemetry.isLive && <span className="text-[9px] text-muted-foreground mt-1">LAST REPORTED: {value === null ? 'NULL' : String(value).toUpperCase()}</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
