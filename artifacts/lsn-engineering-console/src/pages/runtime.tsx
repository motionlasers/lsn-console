import { useStore, SimTimerState, simTimerStateLabel, type RuntimeReading } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityIcon, Timer, Database, Play, Activity, AlertTriangle } from "lucide-react";
import { TelemetryNotice, TelemetryValue, useTelemetryState } from "@/components/TelemetryState";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

function formatTimestamp(ts: number | null) {
  if (!ts) return "--";
  return new Date(ts).toISOString().split('T')[1].replace('Z', '');
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  return `${hours}h ${minutes}m ${seconds}s ${milliseconds}ms`;
}

// The 0/1/2 timer-state values are SIMULATOR-INTERNAL ONLY; the firmware/wire
// enum remains TBD. Present the simulator label (SIM ...) rather than a raw
// number that could be mistaken for a finalized profile value.
function TimerStateLabel({ state }: { state: number }) {
  const label = simTimerStateLabel(state);
  if (state === SimTimerState.Counting) return <span className="text-success font-bold tracking-widest">{label}</span>;
  if (state === SimTimerState.Fault) return <span className="text-destructive font-bold animate-pulse tracking-widest">{label}</span>;
  return <span className="text-muted-foreground font-bold tracking-widest">{label}</span>;
}

function ReadingBox({ title, reading }: { title: string, reading: RuntimeReading | null }) {
  if (!reading) return (
    <div className="border border-border p-4 bg-black/20 rounded-sm text-center flex flex-col justify-center min-h-[100px]">
      <div className="text-[10px] font-mono text-muted-foreground mb-2 uppercase tracking-widest">{title}</div>
      <div className="text-xs font-mono text-muted-foreground opacity-50">NO DATA</div>
    </div>
  );
  
  return (
    <div className="border border-border p-4 bg-black/20 rounded-sm flex flex-col gap-2 min-h-[100px]">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{title}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
        <span className="text-muted-foreground">Time:</span>
        <span className="text-right text-foreground">{formatTimestamp(reading.timestamp)}</span>
        <span className="text-muted-foreground">Runtime:</span>
        <span className="text-right text-foreground">{reading.runtimeMs} ms</span>
        <span className="text-muted-foreground">Enables:</span>
        <span className="text-right text-foreground">{reading.enableCount}</span>
        <span className="text-muted-foreground">State:</span>
        <span className="text-right"><TimerStateLabel state={reading.timerState} /></span>
      </div>
    </div>
  );
}

export default function Runtime() {
  const { 
    mode, 
    connectionState, 
    logicalState, 
    runtimeSession, 
    timerTest, 
    persistenceTest,
    runtimeRead,
    startRuntimeObservation,
    stopRuntimeObservation,
    runGuidedTimerTest,
    runGuidedPersistenceTest,
    continuePersistenceTest
  } = useStore();
  
  const telemetry = useTelemetryState();

  const [timerDur, setTimerDur] = useState(1000);
  const [timerTol, setTimerTol] = useState(50);
  const [persistNote, setPersistNote] = useState("");

  const isConnected = connectionState === 'connected';
  const isSim = mode === 'simulation';
  
  const readBlockedMsg = !isSim
      ? "HARDWARE MODE: NON-TRANSMITTING" 
    : !isConnected
      ? "CONNECT TO DEVICE"
      : !telemetry.isLive 
        ? "TELEMETRY UNKNOWN" 
        : "";

  return (
    <div className="space-y-6 max-w-6xl pb-12 mx-auto">
      <Card data-tour="runtime-counters" className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <ActivityIcon className="w-4 h-4" />
            Runtime & Counters
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="mb-4"><TelemetryNotice /></div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="border border-border p-6 bg-black/20 flex flex-col items-center justify-center gap-3 text-center rounded-sm">
              <Timer className="w-8 h-8 text-primary mb-2" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Timer State</span>
              <TelemetryValue lastReported={<TimerStateLabel state={logicalState.timerState} />} className="items-center">
                <div className="font-mono text-sm mt-1">
                  <TimerStateLabel state={logicalState.timerState} />
                </div>
              </TelemetryValue>
            </div>
            
            <div className="border border-border p-6 bg-black/20 flex flex-col items-center justify-center gap-3 text-center rounded-sm">
              <Timer className="w-8 h-8 text-primary mb-2" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Lifetime Runtime</span>
              <TelemetryValue lastReported={`${logicalState.lifetimeEmissionTimeMs} ms`} className="items-center">
                <div className="font-mono text-center">
                  <div className="text-lg text-foreground font-bold">{formatDuration(logicalState.lifetimeEmissionTimeMs)}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">RAW: {logicalState.lifetimeEmissionTimeMs} ms</div>
                </div>
              </TelemetryValue>
            </div>
            
            <div className="border border-border p-6 bg-black/20 flex flex-col items-center justify-center gap-3 text-center rounded-sm">
              <ActivityIcon className="w-8 h-8 text-primary mb-2" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Enable Cycles</span>
              <TelemetryValue lastReported={logicalState.enableCount} className="items-center">
                <span className="font-mono text-2xl text-foreground font-bold">{logicalState.enableCount}</span>
              </TelemetryValue>
            </div>
            
            <div className={cn(
              "border p-6 bg-black/20 flex flex-col items-center justify-center gap-3 text-center rounded-sm",
              logicalState.storageFailure ? 'border-destructive/50' : 'border-border'
            )}>
              <Database className={cn("w-8 h-8 mb-2", logicalState.storageFailure ? 'text-destructive' : 'text-primary')} />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Persistence Status</span>
              <TelemetryValue lastReported={logicalState.storageFailure ? 'SIMULATED FAILURE' : 'OK'} className="items-center">
                <span className={cn(
                  "font-mono text-sm font-bold",
                  logicalState.storageFailure ? 'text-destructive animate-pulse' : 'text-success'
                )}>
                  {logicalState.storageFailure ? 'SIMULATED FAILURE' : 'OK'}
                </span>
              </TelemetryValue>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-tour="runtime-observation" className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Session Readings & Observation
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="flex gap-4 items-center">
            <Button 
              variant="outline"
              className="font-mono text-xs border-primary text-primary hover:bg-primary/20 h-10 w-48"
              onClick={() => runtimeRead()}
              disabled={!!readBlockedMsg}
            >
              READ RUNTIME
            </Button>
            {readBlockedMsg && <div className="text-[10px] tracking-widest font-mono text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4"/> {readBlockedMsg}</div>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ReadingBox title="First Reading" reading={runtimeSession.firstReading} />
            <ReadingBox title="Last Reading" reading={runtimeSession.lastReading} />
            
            <div className="border border-border p-4 bg-black/20 rounded-sm flex flex-col gap-2 min-h-[100px]">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Session Delta</div>
              {runtimeSession.firstReading && runtimeSession.lastReading ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono mt-1">
                  <span className="text-muted-foreground">Runtime Inc:</span>
                  <span className="text-right text-success font-bold">
                    +{runtimeSession.lastReading.runtimeMs - runtimeSession.firstReading.runtimeMs} ms
                  </span>
                  <span className="text-muted-foreground">Enables Inc:</span>
                  <span className="text-right text-success font-bold">
                    +{runtimeSession.lastReading.enableCount - runtimeSession.firstReading.enableCount}
                  </span>
                </div>
              ) : (
                <div className="text-[10px] font-mono text-muted-foreground opacity-50 mt-1 flex-1 flex items-center justify-center tracking-widest">NO DELTA YET</div>
              )}
            </div>
          </div>

          <div className="border-t border-border/50 pt-6 space-y-4">
            <div className="flex gap-4 items-center justify-between">
              <div className="text-sm font-mono text-foreground font-bold flex items-center gap-2">
                Observation Run
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="font-mono text-[10px] h-8 border-primary text-primary hover:bg-primary/20" disabled={runtimeSession.observation.active || !!readBlockedMsg} onClick={() => startRuntimeObservation()}>START RUNTIME OBSERVATION</Button>
                <Button variant="outline" className="font-mono text-[10px] h-8 border-border text-foreground hover:bg-white/10" disabled={!runtimeSession.observation.active} onClick={() => stopRuntimeObservation()}>STOP RUNTIME OBSERVATION</Button>
              </div>
            </div>
            
            <div className="border border-border/50 bg-black/10 p-4 rounded-sm grid grid-cols-2 md:grid-cols-4 gap-6 text-xs font-mono">
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest border-b border-border/30 pb-2 mb-2">Status</div>
                <div className={runtimeSession.observation.active ? "text-success font-bold" : "text-foreground"}>
                  {runtimeSession.observation.active ? "ACTIVE" : "IDLE"}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase mt-3 tracking-widest border-b border-border/30 pb-2 mb-2">Samples</div>
                <div>{runtimeSession.observation.samples.length}</div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest border-b border-border/30 pb-2 mb-2">Timestamps</div>
                <div className="flex justify-between"><span className="text-muted-foreground">Start:</span> <span>{formatTimestamp(runtimeSession.observation.startedAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Stop:</span> <span>{formatTimestamp(runtimeSession.observation.stoppedAt)}</span></div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest border-b border-border/30 pb-2 mb-2">Runtime (ms)</div>
                <div className="flex justify-between"><span className="text-muted-foreground">Start:</span> <span>{runtimeSession.observation.startRuntimeMs}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Current:</span> <span>{runtimeSession.observation.currentRuntimeMs}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Increase:</span> <span className="text-success font-bold">+{runtimeSession.observation.lsnIncreaseMs}</span></div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest border-b border-border/30 pb-2 mb-2">Deltas vs PC</div>
                <div className="flex justify-between"><span className="text-muted-foreground">PC Elapsed:</span> <span>{runtimeSession.observation.elapsedPcMs}</span></div>
                <div className="flex justify-between border-t border-border/30 pt-2 mt-2">
                  <span className="text-muted-foreground">Difference:</span> 
                  <span className={Math.abs(runtimeSession.observation.differenceMs) > 100 ? "text-warning font-bold" : "text-foreground font-bold"}>
                    {runtimeSession.observation.differenceMs}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-tour="runtime-timer-test" className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Timer className="w-4 h-4" />
            Guided Timer Test
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Test Duration (ms)</label>
                <input 
                  type="number" 
                  value={timerDur} 
                  onChange={e => setTimerDur(Math.max(1, Number(e.target.value)))} 
                  className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" 
                  disabled={timerTest.status === 'running'} 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Tolerance (ms)</label>
                <input 
                  type="number" 
                  value={timerTol} 
                  onChange={e => setTimerTol(Math.max(0, Number(e.target.value)))} 
                  className="w-full bg-black/20 border border-border/50 rounded-sm text-sm font-mono px-3 py-2 text-foreground focus:outline-none focus:border-primary disabled:opacity-50" 
                  disabled={timerTest.status === 'running'} 
                />
              </div>
              <Button 
                variant="outline" 
                className="w-full font-mono text-xs border-primary text-primary hover:bg-primary/20 h-10"
                onClick={() => runGuidedTimerTest({ durationMs: timerDur, toleranceMs: timerTol })}
                disabled={timerTest.status === 'running' || !!readBlockedMsg}
              >
                <Play className="w-4 h-4 mr-2" /> RUN TIMER TEST
              </Button>
              {readBlockedMsg && <div className="text-[10px] font-mono text-destructive flex items-center gap-2 tracking-widest"><AlertTriangle className="w-4 h-4"/> {readBlockedMsg}</div>}
            </div>

            <div className="border border-border/50 bg-black/10 rounded-sm p-4 text-xs font-mono flex flex-col gap-2">
              <div className="flex justify-between border-b border-border/50 pb-2 mb-1">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Status</span>
                <span className={timerTest.status === 'passed' ? 'text-success font-bold' : timerTest.status === 'failed' ? 'text-destructive font-bold' : 'text-foreground font-bold'}>
                  {timerTest.status.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Start Time:</span> <span>{formatTimestamp(timerTest.startedAt)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Finish Time:</span> <span>{formatTimestamp(timerTest.finishedAt)}</span></div>
              <div className="my-2 border-t border-border/20 pt-2"></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Starting Runtime:</span> <span>{timerTest.startRuntimeMs} ms</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Ending Runtime:</span> <span>{timerTest.endRuntimeMs} ms</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">PC Duration:</span> <span>{timerTest.pcMeasuredMs} ms</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">LSN Increase:</span> <span>{timerTest.lsnIncreaseMs} ms</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tolerance:</span> <span>±{timerTest.toleranceMs} ms</span></div>
              <div className="flex justify-between mt-1 pt-2 border-t border-border/20">
                <span className="text-muted-foreground">Difference:</span> 
                <span className={Math.abs(timerTest.differenceMs) > timerTest.toleranceMs ? "text-destructive font-bold" : "text-success font-bold"}>
                  {timerTest.differenceMs} ms
                </span>
              </div>
              {timerTest.notes && (
                <div className="mt-4 text-muted-foreground bg-black/20 p-3 rounded-sm italic border border-border/50 leading-relaxed text-[11px]">
                  {timerTest.notes}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-tour="runtime-persistence-test" className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Database className="w-4 h-4" />
            Guided Persistence Test
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Engineering Notes (Optional)"
                value={persistNote}
                onChange={e => setPersistNote(e.target.value)}
                disabled={persistenceTest.status === 'running'}
                className="w-full bg-black/20 border border-border/50 rounded-sm text-xs font-mono px-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary disabled:opacity-50"
              />
              <Button 
                variant="outline" 
                className="w-full font-mono text-xs border-primary text-primary hover:bg-primary/20 h-10"
                onClick={async () => {
                  await runGuidedPersistenceTest(persistNote);
                  if (isSim) setPersistNote("");
                }}
                disabled={persistenceTest.status === 'running' || (isSim && !isConnected)}
              >
                <Play className="w-4 h-4 mr-2" /> RUN PERSISTENCE TEST
              </Button>
              {isSim && !isConnected && <div className="text-[10px] font-mono text-destructive flex items-center gap-2 tracking-widest"><AlertTriangle className="w-4 h-4"/> CONNECT TO DEVICE</div>}
              {!isSim && <div className="text-[10px] font-mono text-warning flex items-center gap-2 tracking-widest"><AlertTriangle className="w-4 h-4"/> POWER-CYCLE THE LSN, THEN CONTINUE · HARDWARE MODE REMAINS NON-TRANSMITTING</div>}
              
              {persistenceTest.status === 'awaiting_continue' && (
                <div className="p-4 border border-warning/50 bg-warning/10 rounded-sm space-y-4 mt-4">
                  <div className="text-xs font-mono text-warning font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> MANUAL CONTINUATION REQUIRED
                  </div>
                  <div className="text-xs font-mono text-warning/80 leading-relaxed">
                    {persistenceTest.notes}
                  </div>
                  <Button 
                    variant="outline" 
                    className="w-full font-mono text-xs border-warning text-warning hover:bg-warning/20 h-10"
                    onClick={() => {
                      continuePersistenceTest(persistNote);
                      setPersistNote("");
                    }}
                  >
                    CONTINUE <Play className="w-3 h-3 ml-2" />
                  </Button>
                </div>
              )}
            </div>

            <div className="border border-border/50 bg-black/10 rounded-sm p-4 text-xs font-mono flex flex-col gap-2">
              <div className="flex justify-between border-b border-border/50 pb-2 mb-1">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Status / Phase</span>
                <span className={persistenceTest.status === 'passed' ? 'text-success font-bold' : persistenceTest.status === 'failed' ? 'text-destructive font-bold' : 'text-foreground font-bold'}>
                  {persistenceTest.status.toUpperCase()} / {persistenceTest.phase.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Start Time:</span> <span>{formatTimestamp(persistenceTest.startedAt)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Finish Time:</span> <span>{formatTimestamp(persistenceTest.finishedAt)}</span></div>
              
              <div className="my-2 border-t border-border/20 pt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="text-[10px] text-muted-foreground uppercase col-span-2 tracking-widest">Before Restart</div>
                <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Runtime:</span> <span>{persistenceTest.startedAt ? `${persistenceTest.runtimeBeforeMs} ms` : '--'}</span></div>
                <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Firmware:</span> <span>{persistenceTest.firmwareBefore || '--'}</span></div>
                
                <div className="text-[10px] text-muted-foreground uppercase col-span-2 mt-3 pt-3 border-t border-border/20 tracking-widest">After Restart</div>
                <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Runtime:</span> <span>{persistenceTest.finishedAt ? `${persistenceTest.runtimeAfterMs} ms` : '--'}</span></div>
                <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Firmware:</span> <span>{persistenceTest.firmwareAfter || '--'}</span></div>
              </div>
              
              <div className="flex justify-between mt-2 pt-3 border-t border-border/20">
                <span className="text-muted-foreground">Difference:</span> 
                <span className={persistenceTest.differenceMs >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>
                  {persistenceTest.finishedAt ? `${persistenceTest.differenceMs >= 0 ? '+' : ''}${persistenceTest.differenceMs} ms` : '--'}
                </span>
              </div>
              
              {persistenceTest.notes && persistenceTest.status !== 'awaiting_continue' && (
                <div className="mt-4 text-muted-foreground bg-black/20 p-3 rounded-sm italic border border-border/50 leading-relaxed text-[11px]">
                  {persistenceTest.notes}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
