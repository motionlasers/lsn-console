import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, AlertTriangle, Workflow, ShieldCheck, FileJson, Server, Database, Lock, Play, Download, Activity, Cpu, Power, Terminal, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTourStore } from "@/hooks/use-tour";

export default function Help() {
  const { startTour } = useTourStore();

  const PAGE_RESPONSIBILITIES = [
    { path: "/", icon: <Activity className="w-4 h-4"/>, desc: "High-level summary of session state and logical control overview." },
    { path: "/device", icon: <Cpu className="w-4 h-4"/>, desc: "Discover the simulated target and verify identity, firmware, and profile metadata." },
    { path: "/control", icon: <Power className="w-4 h-4"/>, desc: "Issue emission enable requests and observe logical state transitions." },
    { path: "/status", icon: <Activity className="w-4 h-4"/>, desc: "Monitor raw boolean flags and readiness indicators." },
    { path: "/runtime", icon: <Activity className="w-4 h-4"/>, desc: "Validate that timers and enable counts only increment on active outputs." },
    { path: "/diagnostics", icon: <AlertTriangle className="w-4 h-4"/>, desc: "Inject comms/storage faults and verify auto-disable behavior." },
    { path: "/protocol", icon: <Server className="w-4 h-4"/>, desc: "Trace every requested packet and decoded response." },
    { path: "/tests", icon: <ShieldCheck className="w-4 h-4"/>, desc: "Execute automated validation suites and log manual observations." },
    { path: "/stress", icon: <Activity className="w-4 h-4"/>, desc: "Saturate the logical interface with rapid state changes and simulated packet drops." },
    { path: "/firmware", icon: <Server className="w-4 h-4"/>, desc: "Upload simulated payloads and rehearse OTA recovery paths." },
    { path: "/profile", icon: <FileJson className="w-4 h-4"/>, desc: "Browse CIP definitions and expected capability fields." },
    { path: "/modules", icon: <Settings className="w-4 h-4"/>, desc: "Confirm that no optional module capabilities are active in the Phase 1 profile." },
    { path: "/logs", icon: <Terminal className="w-4 h-4"/>, desc: "Inspect transactions and export logs, validation reports, and support bundles." },
  ];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border p-6 rounded-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
            Firmware Programmer Guide
          </h1>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            v0.1 Logical Validation & Simulation Workflows
          </p>
        </div>
        <Button data-testid="button-help-replay-tour" onClick={startTour} variant="outline" className="font-mono text-xs border-primary/30 text-primary hover:bg-primary/10 hover:text-primary">
          <Play className="w-4 h-4 mr-2" />
          REPLAY TOUR
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-warning/50 bg-warning/5 overflow-hidden">
          <div className="h-1 bg-warning w-full" />
          <CardHeader className="pb-3">
            <CardTitle className="text-warning flex items-center gap-2 text-sm font-mono tracking-widest uppercase">
              <AlertTriangle className="w-4 h-4" />
              Safety & Validation Scope
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm font-mono text-warning/90">
            <p>
              This console interacts with logical Emission Control states only. Do NOT assume optical emission capabilities based on console readouts.
            </p>
            <ul className="list-disc pl-5 space-y-2 opacity-90">
              <li>Simulation evidence provided by this tool is strictly for logical validation.</li>
              <li>It does NOT constitute physical validation.</li>
              <li>It does NOT constitute safety certification.</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-destructive/50 bg-destructive/5 overflow-hidden">
          <div className="h-1 bg-destructive w-full" />
          <CardHeader className="pb-3">
            <CardTitle className="text-destructive flex items-center gap-2 text-sm font-mono tracking-widest uppercase">
              <Lock className="w-4 h-4" />
              Hardware Mode Restrictions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm font-mono text-destructive/90">
            <p>
              Hardware Mode enforces strict protocol adherence. Because all CIP hardware mappings are currently TBD in v0.1:
            </p>
            <ul className="list-disc pl-5 space-y-2 opacity-90">
              <li>Hardware acknowledgement <strong className="font-bold underline underline-offset-2">never</strong> unlocks transport or control.</li>
              <li>Firmware-update transmission is disabled on physical hardware.</li>
              <li>Use Simulation Mode for all deterministic UI and workflow validation.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card/50">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Workflow className="w-4 h-4" />
            Recommended Simulation Workflow
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between w-full max-w-4xl mx-auto">
            <div className="flex flex-col items-center text-center space-y-3 p-4 border border-border/50 bg-black/20 rounded-sm w-full md:w-48 relative overflow-hidden group hover:border-primary/50 transition-colors">
              <div className="absolute top-0 right-0 p-2 text-xs font-mono font-bold text-muted-foreground/30 group-hover:text-primary/30 transition-colors">01</div>
              <div className="p-3 bg-primary/10 text-primary rounded-full">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-foreground">Discover & Connect</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">Establish logical session</div>
              </div>
            </div>
            
            <div className="hidden md:block h-px w-8 bg-border shrink-0" />
            
            <div className="flex flex-col items-center text-center space-y-3 p-4 border border-border/50 bg-black/20 rounded-sm w-full md:w-48 relative overflow-hidden group hover:border-primary/50 transition-colors">
              <div className="absolute top-0 right-0 p-2 text-xs font-mono font-bold text-muted-foreground/30 group-hover:text-primary/30 transition-colors">02</div>
              <div className="p-3 bg-primary/10 text-primary rounded-full">
                <FileJson className="w-5 h-5" />
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-foreground">Verify Profile</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">Check capabilities</div>
              </div>
            </div>

            <div className="hidden md:block h-px w-8 bg-border shrink-0" />

            <div className="flex flex-col items-center text-center space-y-3 p-4 border border-border/50 bg-black/20 rounded-sm w-full md:w-48 relative overflow-hidden group hover:border-primary/50 transition-colors">
              <div className="absolute top-0 right-0 p-2 text-xs font-mono font-bold text-muted-foreground/30 group-hover:text-primary/30 transition-colors">03</div>
              <div className="p-3 bg-primary/10 text-primary rounded-full">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-foreground">Run Tests</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">Execute deterministic suite</div>
              </div>
            </div>

            <div className="hidden md:block h-px w-8 bg-border shrink-0" />

            <div className="flex flex-col items-center text-center space-y-3 p-4 border border-border/50 bg-black/20 rounded-sm w-full md:w-48 relative overflow-hidden group hover:border-primary/50 transition-colors">
              <div className="absolute top-0 right-0 p-2 text-xs font-mono font-bold text-muted-foreground/30 group-hover:text-primary/30 transition-colors">04</div>
              <div className="p-3 bg-primary/10 text-primary rounded-full">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-foreground">Export Evidence</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">Save state and logs</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border bg-card/50">
          <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
              <Database className="w-4 h-4" />
              Profile & CIP Mappings
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 font-mono text-sm text-muted-foreground space-y-4">
            <p>
              The <span className="text-primary font-bold">Device Profile</span> dictates expected logical behaviors.
              Exact CIP Assembly mapping, Classes, Instances, and Attributes remain <span className="bg-primary/20 text-primary px-1 rounded-sm">TBD</span> for unreleased services.
            </p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="border border-warning/30 bg-warning/10 p-3">
                <strong className="text-warning block mb-1">Firmware Status</strong>
                Real WT32-ETH01 implementation and hardware validation only.
              </div>
              <div className="border border-primary/30 bg-primary/10 p-3">
                <strong className="text-primary block mb-1">Simulation Status</strong>
                Deterministic test-harness coverage only; never proof of firmware implementation.
              </div>
            </div>
            <div className="border-l-2 border-primary/50 pl-4 py-2 bg-primary/5 pr-4 rounded-r-sm">
              <strong className="text-primary block mb-1">Do not invent CIP mappings.</strong> 
              If a value is TBD, leave it as TBD. Future console updates will dynamically map these fields once firmware endpoint contracts are finalized.
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/50">
          <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
              <Server className="w-4 h-4" />
              Firmware Interruption Rehearsal
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 font-mono text-sm text-muted-foreground space-y-4">
            <p>
              The Firmware page provides a simulation environment to rehearse OTA update failures and rollback behaviors.
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Select a simulated failure scenario (e.g. metadata rejection, network timeout).</li>
              <li>Observe the console's rollback and recovery state machine.</li>
               <li>Review the automatic Basic Validation result and export the resulting evidence.</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card/50">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Page Responsibilities
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {PAGE_RESPONSIBILITIES.map(p => (
              <div key={p.path} className="flex gap-4 items-start border-b border-border/30 pb-3 last:border-0 md:last:border-b-0 hover:bg-white/5 p-2 rounded-sm transition-colors">
                <div className="font-mono text-xs font-bold text-primary w-28 shrink-0 flex items-center gap-2 mt-0.5">
                  {p.icon}
                  {p.path}
                </div>
                <div className="font-mono text-xs text-muted-foreground leading-relaxed">{p.desc}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
