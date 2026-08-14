import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cable, Play, Square, Settings2, ActivitySquare, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

function formatTime(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(1);
  return `${m}m ${s}s`;
}

export default function StressTesting() {
  const { mode, connectionState, stressTestState, startStressTest, stopStressTest } = useStore();
  
  const [cycles, setCycles] = useState(1000);
  const [onDur, setOnDur] = useState(50);
  const [offDur, setOffDur] = useState(150);
  const [maxDuration, setMaxDuration] = useState(0); 
  const [stopOnMismatch, setStopOnMismatch] = useState(true);
  const [stopOnFault, setStopOnFault] = useState(true);
  const [runtimeReadEvery, setRuntimeReadEvery] = useState(10);
  const [enableCountReadEvery, setEnableCountReadEvery] = useState(10);
  const [operationDelay, setOperationDelay] = useState(0);
  const [faultProb, setFaultProb] = useState(0);

  const isSim = mode === 'simulation';
  const isConnected = connectionState === 'connected';
  const lockMessage = !isSim ? "HARDWARE MODE: NON-TRANSMITTING · PROTOCOL MAPPING TBD" : !isConnected ? "CONNECT TO DEVICE" : "";
  const blocked = !!lockMessage;
  
  const handleStart = () => {
    startStressTest({
      cycles: Math.max(1, cycles),
      onDur: Math.max(1, onDur),
      offDur: Math.max(1, offDur),
      maxDuration: Math.max(0, maxDuration),
      stopOnMismatch,
      stopOnFault,
      runtimeReadEvery: Math.max(0, runtimeReadEvery),
      enableCountReadEvery: Math.max(0, enableCountReadEvery),
      operationDelay: Math.max(0, operationDelay),
      faultProb: Math.max(0, Math.min(100, faultProb))
    });
  };

  return (
    <div className="space-y-6 max-w-6xl pb-12 mx-auto">
      <Card className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Cable className="w-4 h-4" />
            Deterministic Stress Testing
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-5 space-y-6">
              <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground border-b border-border/50 pb-2 flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-primary" /> Configuration
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Cycle Count</label>
                  <input type="number" value={cycles} onChange={(e) => setCycles(Number(e.target.value))} disabled={stressTestState.isActive} className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" />
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Fault Prob (%)</label>
                  <input type="number" value={faultProb} onChange={(e) => setFaultProb(Number(e.target.value))} disabled={stressTestState.isActive} className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">ON Duration (ms)</label>
                  <input type="number" value={onDur} onChange={(e) => setOnDur(Number(e.target.value))} disabled={stressTestState.isActive} className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">OFF Duration (ms)</label>
                  <input type="number" value={offDur} onChange={(e) => setOffDur(Number(e.target.value))} disabled={stressTestState.isActive} className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Runtime Read Every N Cycles</label>
                  <input type="number" value={runtimeReadEvery} onChange={(e) => setRuntimeReadEvery(Number(e.target.value))} disabled={stressTestState.isActive} className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Enable Count Read Every N Cycles</label>
                  <input type="number" value={enableCountReadEvery} onChange={(e) => setEnableCountReadEvery(Number(e.target.value))} disabled={stressTestState.isActive} className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Maximum Test Duration (ms; 0=none)</label>
                  <input type="number" value={maxDuration} onChange={(e) => setMaxDuration(Number(e.target.value))} disabled={stressTestState.isActive} className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Operation Delay (ms)</label>
                  <input type="number" value={operationDelay} onChange={(e) => setOperationDelay(Number(e.target.value))} disabled={stressTestState.isActive} className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" />
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-border/30">
                 <label className={cn("flex items-center gap-3 text-xs font-mono text-foreground cursor-pointer", stressTestState.isActive && "opacity-50 cursor-not-allowed")}>
                   <input type="checkbox" checked={stopOnMismatch} onChange={e => setStopOnMismatch(e.target.checked)} disabled={stressTestState.isActive} className="accent-primary w-4 h-4" />
                   Stop on first mismatch
                 </label>
                 <label className={cn("flex items-center gap-3 text-xs font-mono text-foreground cursor-pointer", stressTestState.isActive && "opacity-50 cursor-not-allowed")}>
                   <input type="checkbox" checked={stopOnFault} onChange={e => setStopOnFault(e.target.checked)} disabled={stressTestState.isActive} className="accent-primary w-4 h-4" />
                   Stop on fault
                 </label>
              </div>

            </div>

            <div className="lg:col-span-7 flex flex-col space-y-6">
              <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground border-b border-border/50 pb-2 flex items-center gap-2">
                <ActivitySquare className="w-4 h-4 text-primary" /> Execution & Metrics
              </div>

              <div className="grid grid-cols-2 gap-4 flex-1">
                 <div className="border border-border/50 bg-black/10 rounded-sm p-4 flex flex-col items-center justify-center gap-2 text-center min-h-[140px]">
                   <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Cycles Completed</div>
                   <div className="text-4xl font-mono text-primary font-bold">
                     {stressTestState.completedCycles} <span className="text-xl text-muted-foreground font-normal">/ {stressTestState.isActive ? stressTestState.targetCycles : (cycles || 0)}</span>
                   </div>
                   <div className="text-[10px] font-mono mt-2 text-muted-foreground uppercase tracking-widest">
                     Phase: <span className={stressTestState.isActive ? "text-foreground font-bold" : ""}>{stressTestState.isActive ? stressTestState.phase : "IDLE"}</span>
                   </div>
                 </div>

                 <div className="border border-border/50 bg-black/10 rounded-sm p-4 flex flex-col justify-center gap-2 text-xs font-mono min-h-[140px]">
                   <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground mb-1 border-b border-border/30 pb-2">
                     <span>Final Result</span>
                     <span className={stressTestState.finalResult === 'PASS' ? 'text-success font-bold' : stressTestState.finalResult === 'FAIL' ? 'text-destructive font-bold' : 'text-foreground font-bold'}>
                       {stressTestState.finalResult || 'NONE'}
                     </span>
                   </div>
                   <div className="flex justify-between mt-1">
                      <span className="text-muted-foreground">Communication Errors</span>
                     <span className={stressTestState.commErrors > 0 ? "text-warning font-bold" : ""}>{stressTestState.commErrors}</span>
                   </div>
                   <div className="flex justify-between">
                     <span className="text-muted-foreground">Mismatches</span>
                     <span className={stressTestState.mismatches > 0 ? "text-destructive font-bold" : ""}>{stressTestState.mismatches}</span>
                   </div>
                   <div className="flex justify-between">
                     <span className="text-muted-foreground">Faults</span>
                     <span className={stressTestState.faults > 0 ? "text-destructive font-bold" : ""}>{stressTestState.faults}</span>
                   </div>
                   <div className="flex justify-between border-t border-border/20 pt-2 mt-1">
                     <span className="text-muted-foreground">Stop Reason</span>
                     <span className="text-right ml-2 text-[10px] tracking-widest">{stressTestState.stopReason || '--'}</span>
                   </div>
                 </div>

                 <div className="col-span-2 border border-border/50 bg-black/10 rounded-sm p-4 text-xs font-mono grid grid-cols-2 gap-8">
                   <div className="space-y-3">
                     <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 border-b border-border/30 pb-2">Latency (ms)</div>
                     <div className="flex justify-between"><span className="text-muted-foreground">Min:</span> <span>{stressTestState.latencyMin ?? '--'}</span></div>
                     <div className="flex justify-between"><span className="text-muted-foreground">Avg:</span> <span>{stressTestState.latencyAvg ? stressTestState.latencyAvg.toFixed(1) : '--'}</span></div>
                     <div className="flex justify-between"><span className="text-muted-foreground">Max:</span> <span>{stressTestState.latencyMax ?? '--'}</span></div>
                   </div>
                   <div className="space-y-3">
                     <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 border-b border-border/30 pb-2">Session Deltas</div>
                     <div className="flex justify-between"><span className="text-muted-foreground">Elapsed:</span> <span>{formatTime(stressTestState.elapsedMs)}</span></div>
                     <div className="flex justify-between"><span className="text-muted-foreground">Runtime:</span> <span className={stressTestState.endRuntimeMs > stressTestState.baselineRuntimeMs ? "text-success" : ""}>+{stressTestState.endRuntimeMs - stressTestState.baselineRuntimeMs} ms</span></div>
                     <div className="flex justify-between"><span className="text-muted-foreground">Enables:</span> <span className={stressTestState.endEnableCount > stressTestState.baselineEnableCount ? "text-success" : ""}>+{stressTestState.endEnableCount - stressTestState.baselineEnableCount}</span></div>
                   </div>
                 </div>
              </div>

              <div className="flex gap-4 pt-2">
                <Button 
                  variant="outline" 
                  className="flex-1 font-mono text-xs h-12 border-primary text-primary hover:bg-primary/20"
                  disabled={blocked || stressTestState.isActive}
                  onClick={handleStart}
                >
                  <Play className="w-4 h-4 mr-2" /> START TEST
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1 font-mono text-xs border-border text-foreground hover:bg-white/10 h-12"
                  disabled={blocked || !stressTestState.isActive}
                  onClick={() => stopStressTest()}
                >
                  <Square className="w-4 h-4 mr-2" /> STOP TEST
                </Button>
              </div>
              {blocked && (
                <div className="text-[10px] font-mono text-destructive flex items-center justify-center gap-2 mt-2 tracking-widest">
                  <ShieldAlert className="w-4 h-4" />
                  {lockMessage}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
