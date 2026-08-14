import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cable, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function StressTesting() {
  const { mode, stressTestState, startStressTest, stopStressTest } = useStore();
  
  const [cycles, setCycles] = useState(1000);
  const [onDur, setOnDur] = useState(50);
  const [offDur, setOffDur] = useState(150);
  const [faultProb, setFaultProb] = useState(0);

  return (
    <Card className="max-w-3xl border-border bg-card/50 backdrop-blur">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <Cable className="w-4 h-4" />
          Deterministic Stress Testing
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="text-sm font-mono text-foreground border-b border-border/50 pb-2">Configuration</div>
            
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">Cycle Count</label>
              <input 
                type="number" 
                value={cycles} 
                onChange={(e) => setCycles(Number(e.target.value))} 
                disabled={stressTestState.isActive}
                className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" 
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">Duty Cycle Timing (ms)</label>
              <div className="grid grid-cols-2 gap-2">
                <input 
                  type="number" 
                  placeholder="ON ms" 
                  value={onDur} 
                  onChange={(e) => setOnDur(Number(e.target.value))}
                  disabled={stressTestState.isActive}
                  className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" 
                />
                <input 
                  type="number" 
                  placeholder="OFF ms" 
                  value={offDur} 
                  onChange={(e) => setOffDur(Number(e.target.value))}
                  disabled={stressTestState.isActive}
                  className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" 
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground">Fault Injection Probability</label>
              <select 
                value={faultProb}
                onChange={(e) => setFaultProb(Number(e.target.value))}
                disabled={stressTestState.isActive}
                className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
              >
                <option value="0">0% (None)</option>
                <option value="1">1%</option>
                <option value="5">5%</option>
                <option value="10">10%</option>
              </select>
            </div>
          </div>
          
          <div className="space-y-4 flex flex-col">
            <div className="text-sm font-mono text-foreground border-b border-border/50 pb-2">Status</div>
            
            <div className="flex-1 border border-border/50 bg-black/10 rounded-sm p-4 flex flex-col justify-center items-center gap-2">
              <div className="text-[10px] font-mono text-muted-foreground uppercase">Progress</div>
              <div className="text-3xl font-mono text-primary font-bold">
                {stressTestState.completedCycles} / {stressTestState.isActive ? stressTestState.targetCycles : cycles}
              </div>
              <div className="text-xs font-mono text-muted-foreground mt-2 uppercase">
                {stressTestState.isActive ? `RUNNING - PHASE: ${stressTestState.phase}` : 'IDLE'}
              </div>
            </div>
            
            <div className="flex gap-2 mt-auto">
              <Button 
                variant="outline" 
                className={`flex-1 font-mono text-xs h-10 ${mode === 'hardware' ? 'border-border text-muted-foreground opacity-40 cursor-not-allowed' : 'border-primary text-primary hover:bg-primary/20'}`}
                disabled={mode === 'hardware' || stressTestState.isActive}
                onClick={() => startStressTest({ cycles, onDur, offDur, faultProb })}
              >
                <Play className="w-4 h-4 mr-2" /> START
              </Button>
              <Button 
                variant="outline" 
                className="flex-1 font-mono text-xs border-border text-foreground hover:bg-white/10 h-10"
                disabled={mode === 'hardware' || !stressTestState.isActive}
                onClick={stopStressTest}
              >
                <Square className="w-4 h-4 mr-2" /> STOP
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
