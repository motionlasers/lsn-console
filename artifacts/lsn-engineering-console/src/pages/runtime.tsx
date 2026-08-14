import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityIcon, Timer, Database } from "lucide-react";

export default function Runtime() {
  const { logicalState } = useStore();

  return (
    <Card className="border-border bg-card/50 backdrop-blur">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <ActivityIcon className="w-4 h-4" />
          Runtime & Counters
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-border p-6 bg-black/20 flex flex-col items-center justify-center gap-3 text-center rounded-sm">
            <Timer className="w-8 h-8 text-primary mb-2" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Lifetime Emission Time</span>
            <span className="font-mono text-2xl text-foreground font-bold">
              {logicalState.lifetimeEmissionTimeMs}<span className="text-sm text-muted-foreground font-normal ml-1">ms</span>
            </span>
          </div>
          <div className="border border-border p-6 bg-black/20 flex flex-col items-center justify-center gap-3 text-center rounded-sm">
            <ActivityIcon className="w-8 h-8 text-primary mb-2" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Enable Cycles</span>
            <span className="font-mono text-2xl text-foreground font-bold">
              {logicalState.enableCount}
            </span>
          </div>
          <div className={`border p-6 bg-black/20 flex flex-col items-center justify-center gap-3 text-center rounded-sm ${logicalState.storageFailure ? 'border-destructive/50' : 'border-border'}`}>
            <Database className={`w-8 h-8 mb-2 ${logicalState.storageFailure ? 'text-destructive' : 'text-primary'}`} />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Persistence Status</span>
            <span className={`font-mono text-sm font-bold ${logicalState.storageFailure ? 'text-destructive animate-pulse' : 'text-success'}`}>
              {logicalState.storageFailure ? 'SIMULATED FAILURE' : 'OK'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
