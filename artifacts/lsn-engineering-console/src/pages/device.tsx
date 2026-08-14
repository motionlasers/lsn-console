import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, Power, AlertTriangle, CheckCircle2, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";

export default function HardwareDevice() {
  const { mode, setMode, device, hardwareUnlocked, setHardwareUnlocked } = useStore();
  const [ack, setAck] = useState(false);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
      
      <Card className="col-span-1 border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            Hardware Mode Select
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4">
            <Button
              variant="outline"
              className={cn(
                "h-24 font-mono text-sm border-2 transition-all flex flex-col gap-2",
                mode === 'simulation' ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground bg-transparent hover:border-primary/50 hover:text-primary/50"
              )}
              onClick={() => setMode('simulation')}
            >
              <Power className="w-6 h-6" />
              SIMULATION MODE
            </Button>
            <Button
              variant="outline"
              className={cn(
                "h-24 font-mono text-sm border-2 transition-all flex flex-col gap-2",
                mode === 'hardware' ? "border-destructive text-destructive bg-destructive/10" : "border-border text-muted-foreground bg-transparent hover:border-destructive/50 hover:text-destructive/50"
              )}
              onClick={() => setMode('hardware')}
            >
              <Cpu className="w-6 h-6" />
              HARDWARE MODE
            </Button>
          </div>

          <div className="bg-black/30 border border-border/50 p-4 rounded-sm">
            <div className="text-xs font-mono font-bold text-foreground mb-4">ACTIVE MODE REQUIREMENTS:</div>
            {mode === 'simulation' ? (
              <ul className="text-xs font-mono text-muted-foreground space-y-3">
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-success shrink-0" /> Full client-side simulation loaded</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-success shrink-0" /> Local persistence engine active</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-success shrink-0" /> Virtual fault injection ready</li>
              </ul>
            ) : (
              <ul className="text-xs font-mono text-muted-foreground space-y-3">
                <li className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-destructive shrink-0" /> <span className="font-bold text-destructive">AWAITING FIRMWARE IMPLEMENTATION</span></li>
                <li className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-warning shrink-0" /> <span className="font-bold text-warning">PROTOCOL MAPPING TBD</span></li>
                <li className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-warning shrink-0" /> <span className="font-bold text-warning">MAINTENANCE ENDPOINT NOT YET IMPLEMENTED</span></li>
                <li className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-destructive shrink-0" /> <span className="font-bold text-destructive">HARDWARE VALIDATION REQUIRED</span></li>
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="col-span-1 space-y-6">
        <Card className="border-border bg-card/50 backdrop-blur">
          <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
              <Power className="w-4 h-4" />
              Identity Verification
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-mono text-muted-foreground">Expected Profile</span>
                <span className="text-xs font-mono text-foreground">{device.profile}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-mono text-muted-foreground">Required Protocol</span>
                <span className="text-xs font-mono text-foreground">{device.protocolVersion}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-mono text-muted-foreground">Platform Target</span>
                <span className="text-xs font-mono text-foreground">{device.platform}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-mono text-muted-foreground">Hardware Revision Limit</span>
                <span className="text-xs font-mono text-foreground">&ge; {device.hardwareRevision}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {mode === 'hardware' && !hardwareUnlocked && (
          <Card className="border-destructive/30 bg-destructive/10 backdrop-blur">
             <CardContent className="pt-6">
               <div className="flex flex-col gap-4">
                 <div className="text-sm font-mono font-bold text-destructive flex items-center gap-2">
                   <AlertTriangle className="w-4 h-4" /> HARDWARE CONTROLS LOCKED
                 </div>
                 <p className="text-xs font-mono text-destructive/80">
                    This records a session-scoped bench-test acknowledgement only. It does not enable a transport or permit transmissions while protocol mappings and firmware endpoints remain unavailable.
                 </p>
                 <div className="flex items-center gap-2 mt-2">
                   <Checkbox 
                     id="ack" 
                     checked={ack} 
                     onCheckedChange={(c) => setAck(c as boolean)} 
                     className="border-destructive data-[state=checked]:bg-destructive data-[state=checked]:text-white" 
                   />
                   <label htmlFor="ack" className="text-[10px] font-mono text-destructive/80 cursor-pointer">
                      I acknowledge the bench-test prerequisites and understand that hardware transmission remains locked.
                   </label>
                 </div>
                 <Button 
                   className="w-full font-mono text-xs mt-2 bg-destructive hover:bg-destructive/80 text-white" 
                   disabled={!ack}
                   onClick={() => setHardwareUnlocked(true)}
                 >
                    <LockOpen className="w-3 h-3 mr-2" /> RECORD BENCH ACKNOWLEDGEMENT
                 </Button>
               </div>
             </CardContent>
          </Card>
        )}

        {mode === 'hardware' && hardwareUnlocked && (
          <div className="p-4 border border-warning/50 bg-warning/10 text-warning text-sm font-mono flex items-start gap-3 rounded-sm animate-in slide-in-from-top-4">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
               <strong>HARDWARE OUTPUT BENCH ACKNOWLEDGEMENT RECORDED</strong>
              <p className="text-xs opacity-80 mt-1">
                 Control and maintenance transmissions remain disabled. Protocol mapping, firmware implementation, and physical validation are still required.
              </p>
            </div>
          </div>
        )}
      </div>
      
    </div>
  );
}
