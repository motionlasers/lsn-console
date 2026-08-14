import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert, TerminalSquare, AlertTriangle, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Diagnostics() {
  const { logicalState, clearFault, mode, triggerFault, updateLogicalState, settings, updateSettings } = useStore();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
      <Card className="border-border bg-card/50 backdrop-blur flex flex-col">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Active Faults & Diagnostics
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 flex-1 flex flex-col gap-6">
          {logicalState.faulted ? (
            <div className="border border-destructive/50 bg-destructive/10 p-4 rounded-sm flex flex-col gap-4">
              <div className="text-destructive font-mono text-lg font-bold">
                {logicalState.faultCode}
              </div>
              <p className="text-xs font-mono text-destructive/80">
                A critical safety fault has occurred. Emission control is locked out.
              </p>
              <Button 
                variant="outline" 
                className="font-mono text-xs border-destructive text-destructive hover:bg-destructive hover:text-white self-start"
                onClick={clearFault}
                disabled={mode === 'hardware'}
              >
                REQUEST FAULT CLEAR
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-muted-foreground font-mono text-sm border border-border/20 border-dashed rounded-sm p-6 bg-black/10">
              <span className="mb-4">NO ACTIVE LOGICAL FAULTS</span>
              <Button 
                variant="outline"
                size="sm"
                className="font-mono text-[10px] border-destructive/50 text-destructive hover:bg-destructive hover:text-white"
                onClick={() => triggerFault('MANUAL_TEST_FAULT')}
                disabled={mode === 'hardware'}
              >
                TRIGGER MANUAL FAULT
              </Button>
            </div>
          )}

          <div className="border-t border-border/50 pt-6">
            <div className="text-xs font-mono font-bold mb-4 text-warning">SIMULATED ENVIRONMENT FAILURES</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3 border border-border/50 p-4 bg-black/10 rounded-sm">
                 <div className="text-[10px] font-mono text-muted-foreground uppercase flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3" /> Storage Engine
                 </div>
                 <div className="text-[10px] text-muted-foreground mb-2">Simulate non-volatile memory corruption.</div>
                 <Button 
                   variant="outline" 
                   size="sm" 
                   className={`w-full font-mono text-[10px] ${logicalState.storageFailure ? 'bg-destructive/20 text-destructive border-destructive' : 'text-foreground border-border hover:bg-white/10'}`}
                   onClick={() => updateLogicalState({ storageFailure: !logicalState.storageFailure })}
                   disabled={mode === 'hardware'}
                 >
                   {logicalState.storageFailure ? 'FIX STORAGE' : 'CORRUPT STORAGE'}
                 </Button>
              </div>
              <div className="space-y-3 border border-border/50 p-4 bg-black/10 rounded-sm">
                 <div className="text-[10px] font-mono text-muted-foreground uppercase flex items-center gap-2">
                    <CloudOff className="w-3 h-3" /> Network Transport
                 </div>
                 <div className="text-[10px] text-muted-foreground mb-2">Simulate total network unreachability.</div>
                 <Button 
                   variant="outline" 
                   size="sm" 
                   className={`w-full font-mono text-[10px] ${logicalState.commsLoss ? 'bg-destructive/20 text-destructive border-destructive' : 'text-foreground border-border hover:bg-white/10'}`}
                   onClick={() => updateLogicalState({ commsLoss: !logicalState.commsLoss })}
                   disabled={mode === 'hardware'}
                 >
                   {logicalState.commsLoss ? 'RESTORE COMMS' : 'DROP COMMS'}
                 </Button>
              </div>
              <div className="col-span-2 space-y-3 border border-border/50 p-4 bg-black/10 rounded-sm mt-2">
                 <div className="text-[10px] font-mono text-muted-foreground uppercase flex justify-between">
                    <span>Packet Drop Rate</span>
                    <span className="text-primary">{settings.droppedResponseRate}%</span>
                 </div>
                  <div className="text-[10px] text-muted-foreground mb-2">Deterministic percentage schedule for simulated dropped responses.</div>
                 <input 
                   type="range" 
                   min="0" 
                    max="100" 
                   value={settings.droppedResponseRate} 
                   onChange={(e) => updateSettings({ droppedResponseRate: Number(e.target.value) })}
                   disabled={mode === 'hardware'}
                   className="w-full accent-primary" 
                 />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <TerminalSquare className="w-4 h-4" />
            Active Remediation
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
           {(!logicalState.faulted && !logicalState.storageFailure && !logicalState.commsLoss && settings.droppedResponseRate === 0) ? (
             <div className="text-muted-foreground font-mono text-xs text-center p-8 border border-border/20 border-dashed">
               SYSTEM HEALTHY. NO REMEDIATION REQUIRED.
             </div>
           ) : (
             <div className="space-y-4">
               {logicalState.faulted && (
                 <div className="p-3 bg-black/30 border border-destructive/50 rounded-sm font-mono text-xs flex flex-col gap-2">
                   <strong className="text-destructive">FAULT ASSERTED: {logicalState.faultCode}</strong>
                   <span className="text-muted-foreground">Action: Verify hardware limits. Request Fault Clear.</span>
                 </div>
               )}
               {logicalState.storageFailure && (
                 <div className="p-3 bg-black/30 border border-destructive/50 rounded-sm font-mono text-xs flex flex-col gap-2">
                   <strong className="text-destructive">NVM CORRUPTION DETECTED</strong>
                   <span className="text-muted-foreground">Action: Reformat storage or restore from backup profile.</span>
                 </div>
               )}
               {logicalState.commsLoss && (
                 <div className="p-3 bg-black/30 border border-destructive/50 rounded-sm font-mono text-xs flex flex-col gap-2">
                   <strong className="text-destructive">COMMUNICATION LINK LOST</strong>
                   <span className="text-muted-foreground">Action: Check physical ethernet connection and switch port.</span>
                 </div>
               )}
               {settings.droppedResponseRate > 0 && (
                 <div className="p-3 bg-black/30 border border-warning/50 rounded-sm font-mono text-xs flex flex-col gap-2">
                   <strong className="text-warning">HIGH PACKET DROP RATE ({settings.droppedResponseRate}%)</strong>
                   <span className="text-muted-foreground">Action: Investigate network congestion or interference.</span>
                 </div>
               )}
             </div>
           )}
        </CardContent>
      </Card>
    </div>
  );
}
