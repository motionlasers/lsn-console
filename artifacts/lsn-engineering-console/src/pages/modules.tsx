import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Modules() {
  const { logicalState, updateLogicalState, mode, capabilities, setCapability, settings } = useStore();

  const isEnabled = !!capabilities?.sensors;
  const showDevToggle = settings?.devMode && mode === 'simulation';

  return (
    <Card className="max-w-2xl border-border bg-card/50 backdrop-blur">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Sensor Modules (Simulation)
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        {!isEnabled ? (
          <div className="flex flex-col items-center justify-center p-8 border border-dashed border-border/50 rounded-sm">
            <div className="text-muted-foreground font-mono text-xs text-center mb-4">
              No optional module capabilities are enabled in the active profile.
            </div>
            {showDevToggle && (
              <Button 
                variant="outline"
                size="sm"
                className="font-mono text-xs border-primary text-primary"
                onClick={() => setCapability?.('sensors', true)}
              >
                ENABLE EXPERIMENTAL SENSORS
              </Button>
            )}
          </div>
        ) : (
          <div className="border border-border/50 rounded-sm overflow-hidden">
            <div className="bg-black/20 p-4 border-b border-border/50 flex justify-between items-center">
              <div>
                <div className="font-mono text-sm font-bold text-foreground">Example Env Sensor</div>
                <div className="font-mono text-[10px] text-muted-foreground">ID: MOD-001 • Disabled by default</div>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => updateLogicalState({ modulesEnabled: !logicalState.modulesEnabled })}
                disabled={mode === 'hardware'}
                className={`font-mono text-[10px] h-7 ${logicalState.modulesEnabled ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`} 
              >
                {logicalState.modulesEnabled ? <><Unlock className="w-3 h-3 mr-2" /> ACTIVE</> : <><Lock className="w-3 h-3 mr-2" /> LOCKED</>}
              </Button>
            </div>
            <div className="p-4 font-mono text-xs text-muted-foreground leading-relaxed">
              <p className="mb-4">
                The Module Subsystem provides extension points for arbitrary sensor interfaces (e.g. Temperature, Flow, Door Interlocks) logically mapped via the profile.
              </p>
              {showDevToggle && (
                <Button 
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs border-destructive text-destructive mb-4"
                  onClick={() => setCapability?.('sensors', false)}
                >
                  DISABLE SENSOR CAPABILITY
                </Button>
              )}
              <p>
                In v0.1, the Module interface is restricted. It can be unlocked in simulation mode to test extension mapping logic, but remains strictly locked in Hardware mode to ensure core deterministic validation passes before expanding the parameter space.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
