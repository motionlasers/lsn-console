import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Power, PowerOff, Cpu, Network, Clock, Zap, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { TelemetryNotice, TelemetryValue, useTelemetryState } from "@/components/TelemetryState";

function StatusIndicator({ label, active, color = "success", live }: { label: string, active: boolean, color?: "success" | "primary" | "destructive", live: boolean }) {
  const colorMap = {
    success: "bg-success text-success-foreground border-success",
    primary: "bg-primary text-primary-foreground border-primary",
    destructive: "bg-destructive text-destructive-foreground border-destructive"
  };
  const inactiveClass = "bg-muted text-muted-foreground border-border";

  return (
    <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-foreground/80 font-mono">{label}</span>
      <div className={cn(
        "px-2 py-0.5 text-[10px] font-bold tracking-wider font-mono rounded-sm border text-right",
        live ? (active ? colorMap[color] : inactiveClass) : "bg-warning/10 text-warning border-warning/30"
      )}>
        <div>{live ? (active ? "TRUE" : "FALSE") : "UNKNOWN"}</div>
        {!live && <div className="text-[8px] text-muted-foreground font-normal tracking-normal">LAST REPORTED: {active ? "TRUE" : "FALSE"}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { device, connectionState, logicalState, mode, connect, disconnect, discover, discovered, toggleEnable, setInterlock, setRemoteStop, settings, capabilities, setCapability } = useStore();
  const telemetry = useTelemetryState();

  const handleDiscovery = () => discover();

  const isReady = (!capabilities?.interlock || logicalState.interlockOK) && 
                  (!capabilities?.remoteStop || logicalState.remoteStopOK) && 
                  !logicalState.faulted;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in duration-300">
      
      {/* Device Identity Panel */}
      <Card className="col-span-1 md:col-span-2 border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            Platform Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {discovered || connectionState !== 'disconnected' ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-1">Product</div>
                <div className="text-sm font-mono">{device.product}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-1">Model / Target</div>
                <div className="text-sm font-mono">{device.platform}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-1">IP Address</div>
                <div className="text-sm font-mono text-primary">{device.ip}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-1">Serial Number</div>
                <div className="text-sm font-mono">{device.serial}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-1">Firmware Version</div>
                <div className="text-sm font-mono">{device.firmware}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-1">Active Profile</div>
                <div className="text-sm font-mono text-success">{device.profile}</div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 gap-4">
              <span className="text-xs font-mono text-muted-foreground uppercase">AWAITING DEVICE DISCOVERY</span>
              <Button variant="outline" className="font-mono text-xs border-primary text-primary hover:bg-primary/20" onClick={handleDiscovery} disabled={mode === 'hardware'}>
                <Radar className="w-4 h-4 mr-2" /> DISCOVER
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connection Control */}
      <Card className="col-span-1 border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Network className="w-4 h-4" />
            Session Control
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 flex flex-col gap-4">
          <div className="flex justify-between items-center p-3 border border-border bg-black/20 rounded-sm">
            <span className="text-xs font-mono text-muted-foreground">STATE</span>
            <span className={cn(
              "text-xs font-bold font-mono tracking-wider",
              connectionState === 'connected' ? "text-success" : 
              connectionState === 'faulted' ? "text-destructive" :
              "text-warning"
            )}>
              {connectionState.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-auto">
            <Button 
              variant="outline" 
              className="font-mono text-xs border-primary text-primary hover:bg-primary/20 h-10 disabled:opacity-30 disabled:border-muted disabled:text-muted-foreground"
              onClick={connect}
              disabled={mode === 'hardware' || connectionState === 'connected' || connectionState === 'connecting' || (!discovered && connectionState === 'disconnected')}
            >
              <Power className="w-3 h-3 mr-2" />
              CONNECT
            </Button>
            <Button 
              variant="outline" 
              className="font-mono text-xs border-border text-foreground hover:bg-white/10 h-10 disabled:opacity-30"
              onClick={disconnect}
              disabled={connectionState === 'disconnected'}
            >
              <PowerOff className="w-3 h-3 mr-2" />
              DISCONNECT
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Primary Logical State */}
      <Card className="col-span-1 border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Logical State
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 flex flex-col h-full">
          <div className="flex-1 flex flex-col">
             <TelemetryNotice compact />
             <StatusIndicator label="Ready To Enable" active={isReady} live={telemetry.isLive} />
             <StatusIndicator label="Requested Enable" active={logicalState.requestedEnable} color="primary" live={telemetry.isLive} />
             <StatusIndicator label="Emission Output Active" active={logicalState.emissionControlOutputActive} color="primary" live={telemetry.isLive} />
             {capabilities?.interlock && <StatusIndicator label="Interlock OK" active={logicalState.interlockOK} live={telemetry.isLive} />}
             {capabilities?.remoteStop && <StatusIndicator label="Remote Stop OK" active={logicalState.remoteStopOK} live={telemetry.isLive} />}
             <StatusIndicator label="Fault State" active={logicalState.faulted} color="destructive" live={telemetry.isLive} />
          </div>
        </CardContent>
      </Card>

      {/* Manual Overrides (Simulation) */}
      <Card className="col-span-1 md:col-span-2 border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Primary Controls
          </CardTitle>
          <div className={cn("text-[10px] font-mono px-2 py-1 rounded", mode === 'hardware' ? 'bg-destructive/20 text-destructive border border-destructive/50' : 'bg-black/30 text-muted-foreground')}>
            {mode === 'hardware' ? 'HARDWARE TRANSPORT LOCKED' : 'SIMULATION ACTIVE'}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1 flex flex-col gap-2">
              <Button 
                className={cn(
                  "h-16 font-mono text-sm tracking-wider w-full rounded-sm",
                  logicalState.requestedEnable 
                    ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" 
                    : "bg-primary hover:bg-primary/90 text-primary-foreground"
                )}
                disabled={mode === 'hardware' || connectionState !== 'connected'}
                onClick={() => toggleEnable(!logicalState.requestedEnable)}
              >
                {logicalState.requestedEnable ? "CANCEL ENABLE REQ" : "EMISSION ENABLE REQ"}
              </Button>
              <div className="text-[10px] text-muted-foreground font-mono text-center">
                 Last Reported Stop: {logicalState.lastDisableReason || 'N/A'}
              </div>
            </div>

            <div className="col-span-2 grid grid-cols-2 gap-4">
              {(capabilities?.interlock || capabilities?.remoteStop) && (
                <div className="border border-border/50 p-4 rounded-sm bg-black/10 flex flex-col justify-between">
                  <div className="text-xs font-mono text-muted-foreground mb-4">SIMULATION INJECTION</div>
                  <div className="grid grid-cols-2 gap-2">
                    {capabilities?.interlock && (
                      <Button variant="outline" size="sm" className={cn("font-mono text-[10px] h-8", !logicalState.interlockOK ? "bg-destructive text-white border-destructive" : "border-destructive/50 text-destructive hover:bg-destructive hover:text-white")}
                        onClick={() => setInterlock(!logicalState.interlockOK)} disabled={mode === 'hardware'}>
                        {logicalState.interlockOK ? 'BRK INTERLOCK' : 'FIX INTERLOCK'}
                      </Button>
                    )}
                    {capabilities?.remoteStop && (
                      <Button variant="outline" size="sm" className={cn("font-mono text-[10px] h-8", !logicalState.remoteStopOK ? "bg-destructive text-white border-destructive" : "border-destructive/50 text-destructive hover:bg-destructive hover:text-white")}
                        onClick={() => setRemoteStop(!logicalState.remoteStopOK)} disabled={mode === 'hardware'}>
                        {logicalState.remoteStopOK ? 'ASSERT REM STOP' : 'CLR REM STOP'}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <div className={cn("border border-border/50 p-4 rounded-sm bg-black/10 flex flex-col justify-between", !(capabilities?.interlock || capabilities?.remoteStop) ? "col-span-2" : "")}>
                <div className="text-xs font-mono text-muted-foreground mb-4">LIFETIME STATS</div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-muted-foreground">Enabled:</span>
                     <TelemetryValue lastReported={`${logicalState.enableCount}x`}>
                       <span className="text-foreground">{logicalState.enableCount}x</span>
                     </TelemetryValue>
                  </div>
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-muted-foreground">Runtime:</span>
                     <TelemetryValue lastReported={`${(logicalState.lifetimeEmissionTimeMs / 1000 / 60).toFixed(2)}m`}>
                       <span className="text-foreground">{(logicalState.lifetimeEmissionTimeMs / 1000 / 60).toFixed(2)}m</span>
                     </TelemetryValue>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {settings?.devMode && mode === 'simulation' && (
        <Card className="col-span-1 md:col-span-3 border-destructive/50 bg-black/40 backdrop-blur">
          <CardHeader className="border-b border-destructive/30 bg-destructive/10 pb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-destructive flex items-center gap-2">
              <Zap className="w-4 h-4" />
              SIMULATION / DEVELOPER EXPERIMENTAL CAPABILITIES
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 flex gap-4">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setCapability?.('interlock', !capabilities?.interlock)}
              className={cn("font-mono text-xs h-8 border", capabilities?.interlock ? "border-primary text-primary" : "border-muted text-muted-foreground")}
            >
              Interlock {capabilities?.interlock ? 'ON' : 'OFF'}
            </Button>
            <Button 
              variant="outline"
              size="sm"
              onClick={() => setCapability?.('remoteStop', !capabilities?.remoteStop)}
              className={cn("font-mono text-xs h-8 border", capabilities?.remoteStop ? "border-primary text-primary" : "border-muted text-muted-foreground")}
            >
              Remote Stop {capabilities?.remoteStop ? 'ON' : 'OFF'}
            </Button>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
