import { useStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, Power, PowerOff, AlertTriangle, CheckCircle2, Search, MapPin, Radar, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TelemetryNotice, useTelemetryState } from "@/components/TelemetryState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDesktopBridge } from "@/lib/desktop";

import { useLocation } from "wouter";

export default function HardwareDevice() {
  const {
    mode,
    setMode,
    device,
    hardwareCandidates,
    selectedCandidate,
    selectCandidate,
    discover,
    discoveryStatus,
    discoveryError,
    manualProbeIp,
    setManualProbeIp,
    connectionState,
    connect,
    disconnect,
    profileReadiness,
  } = useStore();
  const telemetry = useTelemetryState();
  const [, setLocation] = useLocation();
  const desktopAvailable = getDesktopBridge() !== null;
  const readinessIssues = Array.from(
    new Map(
      [
        ...(profileReadiness?.stateRead?.issues ?? []),
        ...(profileReadiness?.enable?.issues ?? []),
      ].map(issue => [`${issue.symbolicName}:${issue.code}`, issue]),
    ).values(),
  ).slice(0, 5);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">

      <div className="col-span-1 space-y-6">
        <Card data-tour="device-mode" className="border-border bg-card/50 backdrop-blur">
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
              ) : desktopAvailable ? (
                <ul className="text-xs font-mono text-muted-foreground space-y-3">
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-success shrink-0" /> <span className="font-bold text-success">ETHERNET/IP DISCOVERY ENABLED</span></li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-success shrink-0" /> <span className="font-bold text-success">PHYSICAL SESSION ENABLED</span></li>
                  <li className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-warning shrink-0" /> <span className="font-bold text-warning">{profileReadiness?.controlReady ? 'PROFILE CONTROL READY' : 'PROFILE MAPPING INCOMPLETE'}</span></li>
                </ul>
              ) : (
                <div className="flex items-start gap-2 text-xs font-mono text-warning">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span><strong>BROWSER RUNTIME DETECTED.</strong> Physical UDP/TCP access requires the packaged Windows desktop app. This browser remains Simulation-only.</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {mode === 'hardware' && (
          <Card className="border-border bg-card/50 backdrop-blur">
             <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
               <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
                 <Search className="w-4 h-4" />
                 Hardware Discovery
               </CardTitle>
             </CardHeader>
             <CardContent className="pt-6 space-y-6">
                <div className="space-y-2">
                   <Label className="text-xs font-mono text-muted-foreground">Manual IPv4 Probe</Label>
                   <div className="flex gap-2">
                       <Input
                        placeholder="e.g. 192.168.1.100"
                        value={manualProbeIp}
                        onChange={(e) => setManualProbeIp(e.target.value)}
                         disabled={!desktopAvailable}
                         className="font-mono text-sm bg-black/20 border-border/50 focus-visible:ring-1 focus-visible:ring-primary h-10"
                      />
                       <Button variant="outline" className="h-10 font-mono text-xs border-primary/50 text-primary hover:bg-primary/20" onClick={() => discover(manualProbeIp || undefined)} disabled={!desktopAvailable || discoveryStatus === 'scanning' || !manualProbeIp}>
                         {discoveryStatus === 'scanning' && manualProbeIp ? <Radar className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />}
                         PROBE
                      </Button>
                   </div>
                </div>

                <div className="space-y-2">
                   <div className="flex justify-between items-center">
                     <Label className="text-xs font-mono text-muted-foreground">LAN Candidates</Label>
                      <Button variant="ghost" size="sm" className="h-6 font-mono text-[10px] text-muted-foreground hover:text-primary" onClick={() => discover()} disabled={!desktopAvailable || discoveryStatus === 'scanning'}>
                        {discoveryStatus === 'scanning' && !manualProbeIp ? <Radar className="w-3 h-3 mr-1 animate-spin" /> : <Radar className="w-3 h-3 mr-1" />}
                        SCAN ALL
                     </Button>
                   </div>

                   <div className="bg-black/30 border border-border/50 rounded-sm overflow-hidden min-h-[120px]">
                      {discoveryStatus === 'scanning' ? (
                         <div className="p-6 flex flex-col items-center justify-center text-muted-foreground">
                            <Radar className="w-6 h-6 animate-spin mb-2 opacity-50" />
                            <span className="text-xs font-mono">SCANNING NETWORK...</span>
                         </div>
                      ) : hardwareCandidates.length > 0 ? (
                         <div className="divide-y divide-border/50 max-h-[200px] overflow-y-auto">
                             {hardwareCandidates.map(c => (
                               <div
                                  key={`${c.sourceAddress ?? c.socketAddress}:${c.serialNumber}`}
                                 className={cn(
                                   "p-3 cursor-pointer flex justify-between items-center transition-colors",
                                   selectedCandidate?.sourceAddress === c.sourceAddress ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-white/5 border-l-2 border-l-transparent"
                                 )}
                                 onClick={() => selectCandidate(c)}
                               >
                                  <div>
                                     <div className="text-xs font-mono text-foreground font-bold">{c.sourceAddress || 'Unknown IP'}</div>
                                     <div className="text-[10px] font-mono text-muted-foreground">{c.productName || 'Unknown Device'} (SN: {c.serialNumber})</div>
                                  </div>
                                  {selectedCandidate?.sourceAddress === c.sourceAddress && <CheckCircle2 className="w-4 h-4 text-primary" />}
                               </div>
                            ))}
                         </div>
                      ) : (
                         <div className="p-6 flex flex-col items-center justify-center text-muted-foreground h-full">
                            {discoveryError ? (
                               <div className="text-center">
                                  <AlertTriangle className="w-6 h-6 text-destructive/50 mx-auto mb-2" />
                                  <span className="text-[10px] font-mono text-destructive break-words">{discoveryError}</span>
                               </div>
                            ) : (
                               <span className="text-xs font-mono">NO DEVICES FOUND</span>
                            )}
                         </div>
                      )}
                   </div>
                </div>
             </CardContent>
          </Card>
        )}
      </div>

      <div className="col-span-1 space-y-6">
        <Card data-tour="device-identity" className="border-border bg-card/50 backdrop-blur">
          <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
            <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
              <Power className="w-4 h-4" />
              Identity Verification
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="mb-4"><TelemetryNotice compact /></div>
            <div className={`mb-4 border p-3 rounded-sm font-mono text-[10px] ${telemetry.isLive ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
              IDENTITY VERIFICATION: {mode === 'hardware' ? (telemetry.isLive ? 'PHYSICAL DEVICE RESPONSE' : 'UNKNOWN · NO CURRENT DEVICE RESPONSE') : (telemetry.isLive ? 'CURRENT SIMULATION RESPONSE' : 'UNKNOWN · NO CURRENT DEVICE RESPONSE')}
            </div>
            <div className="space-y-4">
              {mode === 'hardware' && selectedCandidate ? (
                <>
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-xs font-mono text-muted-foreground">Observed Address</span>
                    <span className="text-xs font-mono text-primary font-bold">{selectedCandidate.sourceAddress}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-xs font-mono text-muted-foreground">Product Name</span>
                    <span className="text-xs font-mono text-foreground">{selectedCandidate.productName}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-xs font-mono text-muted-foreground">Vendor / Device / Code</span>
                    <span className="text-xs font-mono text-foreground">{selectedCandidate.vendorId} / {selectedCandidate.deviceType} / {selectedCandidate.productCode}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-xs font-mono text-muted-foreground">Revision</span>
                    <span className="text-xs font-mono text-foreground">{selectedCandidate.revision}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-xs font-mono text-muted-foreground">Compatibility</span>
                    <span className="text-xs font-mono text-warning font-bold">UNVERIFIED (MAPPING TBD)</span>
                  </div>
                   <div className="flex justify-between border-b border-border/50 pb-2">
                     <span className="text-xs font-mono text-muted-foreground">Session</span>
                     <span className={cn(
                       "text-xs font-mono font-bold",
                       connectionState === 'connected' ? "text-success" :
                         connectionState === 'faulted' ? "text-destructive" : "text-warning",
                     )}>{connectionState.toUpperCase()}</span>
                   </div>
                   <div className="grid grid-cols-2 gap-2 pt-2">
                     <Button
                       variant="outline"
                       className="font-mono text-xs border-primary text-primary"
                       disabled={!desktopAvailable || connectionState === 'connected' || connectionState === 'connecting'}
                       onClick={() => connect()}
                     >
                       <Network className="w-3 h-3 mr-2" /> CONNECT
                     </Button>
                     <Button
                       variant="outline"
                       className="font-mono text-xs"
                       disabled={connectionState === 'disconnected'}
                       onClick={disconnect}
                     >
                       <PowerOff className="w-3 h-3 mr-2" /> DISCONNECT
                     </Button>
                   </div>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>

            {mode === 'hardware' && selectedCandidate && (
              <div className="mt-6 p-4 border border-warning/50 bg-warning/10 text-warning text-sm font-mono rounded-sm space-y-2">
                 <div className="flex items-start gap-2">
                   <AlertTriangle className="w-5 h-5 shrink-0" />
                   <div>
                     <strong>PROTOCOL MAPPING REQUIRED</strong>
                     <p className="text-[10px] mt-1 text-warning/80">
                       ListIdentity and RegisterSession work now, but control and telemetry remain locked until exact profile mapping and wire encoding are supplied.
                     </p>
                   </div>
                 </div>
                 <Button variant="link" className="text-xs font-mono text-warning hover:text-warning/80 p-0 h-auto" onClick={() => setLocation('/profile')}>
                   Review TBD Profile Mappings →
                 </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div data-tour="device-hardware-lock">
        {mode === 'hardware' && (
          <Card className={cn(
            "backdrop-blur",
            profileReadiness?.controlReady
              ? "border-success/30 bg-success/10"
              : "border-warning/30 bg-warning/10",
          )}>
            <CardContent className="pt-6 space-y-3">
              <div className={cn(
                "text-sm font-mono font-bold flex items-center gap-2",
                profileReadiness?.controlReady ? "text-success" : "text-warning",
              )}>
                {profileReadiness?.controlReady
                  ? <CheckCircle2 className="w-4 h-4" />
                  : <AlertTriangle className="w-4 h-4" />}
                {profileReadiness?.controlReady ? 'PROFILE CONTROL READY' : 'PHYSICAL CONTROL LOCKED'}
              </div>
              <p className="text-xs font-mono text-muted-foreground">
                Enable requires a native Windows confirmation and fresh main-process preflight reads. Disable remains available without re-arming when the resolved mapping and session are usable.
              </p>
              {readinessIssues.length > 0 && (
                <ul className="space-y-1 text-[10px] font-mono text-warning">
                  {readinessIssues.map(issue => (
                    <li key={`${issue.symbolicName}:${issue.code}`}>
                      {issue.symbolicName}: {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              {!profileReadiness && desktopAvailable && (
                <p className="text-[10px] font-mono text-muted-foreground">Loading pinned profile readiness…</p>
              )}
              <Button variant="link" className="p-0 h-auto text-xs font-mono" onClick={() => setLocation('/profile')}>
                Review Device Profile →
              </Button>
            </CardContent>
          </Card>
        )}
        </div>
      </div>

    </div>
  );
}
