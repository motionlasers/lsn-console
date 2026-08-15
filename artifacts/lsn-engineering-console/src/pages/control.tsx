import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaySquare, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TelemetryNotice, TelemetryValue, useTelemetryState } from "@/components/TelemetryState";

export default function Control() {
  const { logicalState, toggleEnable, mode, connectionState, transactions, capabilities } = useStore();
  const telemetry = useTelemetryState();

  const disabled = mode === 'hardware' || connectionState !== 'connected';
  const disabledReason =
    mode === 'hardware'
        ? 'HARDWARE OUTPUT TESTS LOCKED · PROTOCOL MAPPING TBD · AWAITING FIRMWARE IMPLEMENTATION'
      : connectionState !== 'connected'
        ? 'CONNECT TO DEVICE TO SEND CONTROL REQUESTS'
        : null;

  // Find most recent control transaction
  const recentControlTx = transactions.find(t => t.relatedAction === 'toggleEnable');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
      <div className="col-span-1 space-y-6">
        <Card data-tour="control-emission" className="border-border bg-card/50 backdrop-blur">
          <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
              <PlaySquare className="w-4 h-4" />
              Emission Control
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-8 flex flex-col items-center">
            <div className="w-full mb-6"><TelemetryNotice compact /></div>
            <div className="w-full max-w-xs space-y-8">
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="font-mono text-xs text-muted-foreground">Emission Enable Request</span>
                <TelemetryValue lastReported={logicalState.requestedEnable ? 'ENABLE' : 'DISABLE'}>
                  <span className={`font-mono text-xs font-bold ${logicalState.requestedEnable ? 'text-primary' : 'text-muted-foreground'}`}>
                    {logicalState.requestedEnable ? 'ENABLE' : 'DISABLE'}
                  </span>
                </TelemetryValue>
              </div>
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="font-mono text-xs text-muted-foreground">Reported Permitted</span>
                <TelemetryValue lastReported={logicalState.reportedEnablePermitted ? 'YES' : 'NO'}>
                  <span className={`font-mono text-xs font-bold ${logicalState.reportedEnablePermitted ? 'text-success' : 'text-destructive'}`}>
                    {logicalState.reportedEnablePermitted ? 'YES' : 'NO'}
                  </span>
                </TelemetryValue>
              </div>
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="font-mono text-xs text-muted-foreground">Emission Control Output Active</span>
                <TelemetryValue lastReported={logicalState.emissionControlOutputActive ? 'ACTIVE' : 'INACTIVE'}>
                  <span className={`font-mono text-xs font-bold ${logicalState.emissionControlOutputActive ? 'text-primary animate-pulse' : 'text-muted-foreground'}`}>
                    {logicalState.emissionControlOutputActive ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </TelemetryValue>
              </div>

              <Button 
                className={`w-full h-16 font-mono text-sm tracking-wider ${logicalState.requestedEnable ? 'bg-destructive hover:bg-destructive/90 text-white' : 'bg-primary hover:bg-primary/90 text-black'}`}
                disabled={disabled}
                onClick={() => toggleEnable(!logicalState.requestedEnable)}
              >
                {logicalState.requestedEnable ? "CANCEL ENABLE REQ" : "EMISSION ENABLE REQ"}
              </Button>
              
              {disabled && (
                <div className="text-center font-mono text-[10px] text-destructive mt-2">
                  {disabledReason}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card data-tour="control-safety" className="border-border bg-card/50 backdrop-blur">
          <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {capabilities?.interlock || capabilities?.remoteStop ? 'Safety Interlocks' : 'Core Fault State'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {capabilities?.interlock && (
                <div className={`p-4 border rounded-sm font-mono text-xs flex justify-between items-center ${logicalState.interlockOK ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
                  <span>Logical Interlock Loop</span>
                  <span className="font-bold">{logicalState.interlockOK ? 'CLOSED (OK)' : 'OPEN (FAULT)'}</span>
                </div>
              )}
              {capabilities?.remoteStop && (
                <div className={`p-4 border rounded-sm font-mono text-xs flex justify-between items-center ${logicalState.remoteStopOK ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
                  <span>Network Remote Stop</span>
                  <span className="font-bold">{logicalState.remoteStopOK ? 'CLEAR (OK)' : 'STOP ASSERTED'}</span>
                </div>
              )}
                <div className={`p-4 border rounded-sm font-mono text-xs flex justify-between items-center ${!telemetry.isLive ? 'border-warning/30 bg-warning/10 text-warning' : !logicalState.faulted ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
                <span>Internal State Machine</span>
                  <span className="font-bold">{telemetry.isLive ? (!logicalState.faulted ? 'READY' : `FAULT: ${logicalState.faultCode}`) : `UNKNOWN · LAST: ${!logicalState.faulted ? 'READY' : `FAULT ${logicalState.faultCode}`}`}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="col-span-1">
        <Card className="h-full border-border bg-card/50 backdrop-blur flex flex-col">
          <CardHeader data-tour="control-recent" className="border-b border-border/50 bg-black/20 pb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Recent Control Action
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 flex-1">
            {recentControlTx ? (
              <div className="space-y-4 font-mono text-xs flex flex-col h-full">
                <div className="flex justify-between items-center border-b border-border/50 pb-2">
                   <span className="text-muted-foreground">Action Status</span>
                   <span className={`font-bold px-2 py-0.5 rounded-sm ${recentControlTx.pass ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                     {recentControlTx.pass ? 'PASS' : 'FAIL'}
                   </span>
                </div>
                <div className="grid grid-cols-2 gap-4 border-b border-border/50 pb-4">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Expected Behavior</div>
                    <div className="text-foreground">{recentControlTx.expectedResult}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Actual Behavior</div>
                    <div className={recentControlTx.pass ? 'text-success' : 'text-destructive'}>{recentControlTx.actualResult}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase">
                    <span>Simulated Request</span>
                    <span>{recentControlTx.latency}ms</span>
                  </div>
                  <div className="bg-black/30 p-2 border border-border/30 rounded-sm break-all text-primary">
                     {recentControlTx.requestHex || 'NO DATA'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{recentControlTx.requestDecoded}</div>
                </div>
                
                <div className="space-y-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Simulated Response</div>
                  <div className="bg-black/30 p-2 border border-border/30 rounded-sm break-all text-success">
                     {recentControlTx.responseHex || 'NO DATA'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{recentControlTx.responseDecoded}</div>
                </div>

                <div className="mt-auto pt-4 text-[10px] text-muted-foreground opacity-50 italic border-t border-border/30">
                   Simulator envelope bytes only. CIP service, identity, and field mappings remain TBD and are never inferred.
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm text-center border border-dashed border-border/30 rounded-sm">
                NO RECENT CONTROL ACTIONS
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
