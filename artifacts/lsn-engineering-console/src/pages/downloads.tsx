import { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Download, PackageOpen, Monitor, FileJson, 
  FileCode2, FileText, ChevronDown, ChevronRight, 
  AlertTriangle, Table, Info, ListTree, Loader2, CheckCircle2, Server
} from 'lucide-react';
import { createFirmwareIntegrationPackage, summarizeFirmwarePackage } from '@/lib/firmware-package';
import { downloadBlob, downloadFile } from '@/lib/exports';
import consolePackage from '../../package.json';

export default function Downloads() {
  const { activeProfileDocument, capabilities } = useStore();
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [previousExpanded, setPreviousExpanded] = useState(false);
  
  const [isGeneratingItem, setIsGeneratingItem] = useState<string | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  
  const [zipState, setZipState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [zipHash, setZipHash] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

  const packageSummary = useMemo(
    () => summarizeFirmwarePackage(activeProfileDocument, capabilities),
    [activeProfileDocument, capabilities]
  );

  const handleZipDownload = async () => {
    setZipState('generating');
    setZipError(null);
    setZipHash(null);
    try {
      const result = await createFirmwareIntegrationPackage(activeProfileDocument, capabilities);
      downloadBlob(result.blob, result.filename);
      
      try {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
          const hashBuffer = await crypto.subtle.digest('SHA-256', await result.blob.arrayBuffer());
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          setZipHash(hashHex);
        } else {
          setZipHash('SHA-256 computation unavailable in current context.');
        }
      } catch {
        setZipHash('SHA-256 computation failed.');
      }
      
      setZipState('ready');
    } catch (err) {
      setZipState('error');
      setZipError(err instanceof Error ? err.message : 'Unknown error generating package.');
    }
  };

  const handleIndividualDownload = async (filename: string, mimeType: string) => {
    setIsGeneratingItem(filename);
    setItemError(null);
    try {
      const result = await createFirmwareIntegrationPackage(activeProfileDocument, capabilities);
      const content = result.files[filename];
      if (content) {
        downloadFile(content, filename, mimeType);
      } else {
        throw new Error(`${filename} was not present in the generated package.`);
      }
    } catch (error) {
      setItemError(error instanceof Error ? error.message : `Unable to generate ${filename}.`);
    } finally {
      setIsGeneratingItem(null);
    }
  };

  const WORKFLOW_STEPS = [
    {
      title: "Web Tour & Simulation",
      desc: "Complete the guided web tour and utilize the simulation harness to explore logical constraints."
    },
    {
      title: "Windows Installation",
      desc: "Await Windows Console availability to bypass browser network limits for hardware discovery."
    },
    {
      title: "Package Review",
      desc: "Generate and review the Firmware Integration Package summary against active profile requirements."
    },
    {
      title: "Logical Behaviors",
      desc: "Read lsn_interface.md to comprehend the intended functional outcomes of each device profile field."
    },
    {
      title: "Header Integration",
      desc: "Copy the generated lsn_protocol.h and lsn_protocol_types.h into your ESP-IDF firmware project."
    },
    {
      title: "Firmware Implementation",
      desc: "Write firmware logic and explicitly assign real EtherNet/IP mappings to any TBD placeholders."
    },
    {
      title: "Mapping Return",
      desc: "Record your concrete mapping decisions into lsn_protocol_profile.json and import back into the console."
    },
    {
      title: "Physical Testing",
      desc: "Flash the WT32-ETH01, connect via the Windows application on a private network, and execute hardware validation."
    },
    {
      title: "Status Progression",
      desc: "Advance profile field states from TBD to IMPLEMENTING, then TESTING, and finally VERIFIED."
    }
  ];

  return (
    <div className="flex flex-col h-full gap-6 animate-in fade-in duration-300">
      
      <div className="mb-2">
        <h1 data-tour="downloads-release" className="text-2xl font-mono text-foreground font-bold uppercase tracking-wider mb-2">LSN Developer Downloads</h1>
        <p className="text-xs font-mono text-muted-foreground max-w-4xl leading-relaxed">
          Download the current desktop engineering tools, firmware interface package, and protocol resources for LSN development and hardware validation.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
        {[
          ["Console", `v${consolePackage.version}`],
          ["Protocol", activeProfileDocument.protocolVersion],
          ["Device Profile", `lsn-v${activeProfileDocument.profileVersion}`],
          ["Target Platform", `${activeProfileDocument.hardwareFamily} / ESP32`],
        ].map(([label, value]) => (
          <div key={label} className="border border-border bg-card/50 p-3 rounded-sm">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest">{label}</div>
            <div className="mt-1 text-foreground font-bold">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column: Releases & Roles */}
        <div className="xl:col-span-1 flex flex-col gap-6">
          
          <Card className="border-border bg-card/50 backdrop-blur">
            <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
              <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
                <Server className="w-4 h-4" />
                Role Clarification
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4 text-[11px] font-mono text-muted-foreground leading-relaxed">
              <div className="border-l-2 border-primary/50 pl-3">
                <strong className="text-foreground block mb-1">Web Application (Current)</strong>
                Hosted via development server. Constrained by the browser sandbox, strictly preventing direct UDP/TCP socket bindings. Suitable for logical simulation, profile authoring, and generating definitions.
              </div>
              <div className="border-l-2 border-warning/50 pl-3">
                <strong className="text-foreground block mb-1">Windows Desktop Application</strong>
                Packaged Electron binary with full network stack capabilities. Required to broadcast on private networks, execute physical device discovery, and maintain stable EtherNet/IP hardware communication.
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/50 backdrop-blur">
            <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
              <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
                <Monitor className="w-4 h-4" />
                Console Release
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col gap-6">
              
              <div className="border border-border/50 p-5 bg-black/30 rounded-sm">
                <div className="flex flex-col gap-2 mb-4 border-b border-border/50 pb-4">
                  <div className="flex justify-between items-start">
                    <div className="font-mono text-sm font-bold text-foreground">Windows Console</div>
                    <div className="text-[10px] font-mono text-warning border border-warning/30 bg-warning/10 px-2 py-1 whitespace-nowrap">
                      WINDOWS BUILD PENDING
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    Expected: LSN-Engineering-Console-Setup-{consolePackage.version}.exe
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-y-4 gap-x-4 text-[10px] font-mono mb-6">
                  <div><span className="text-muted-foreground block mb-0.5 uppercase tracking-wider text-[9px]">Platform</span> <span className="text-foreground">Windows 10/11</span></div>
                  <div><span className="text-muted-foreground block mb-0.5 uppercase tracking-wider text-[9px]">Architecture</span> <span className="text-foreground">TBD</span></div>
                  <div><span className="text-muted-foreground block mb-0.5 uppercase tracking-wider text-[9px]">Release</span> <span className="text-foreground">Internal Engineering / Dev</span></div>
                  <div><span className="text-muted-foreground block mb-0.5 uppercase tracking-wider text-[9px]">Date</span> <span className="text-foreground">2026-08-14</span></div>
                  <div><span className="text-muted-foreground block mb-0.5 uppercase tracking-wider text-[9px]">Size</span> <span className="text-foreground">Pending</span></div>
                  <div><span className="text-muted-foreground block mb-0.5 uppercase tracking-wider text-[9px]">Version</span> <span className="text-foreground">{consolePackage.version}</span></div>
                </div>

                <Button disabled variant="outline" className="w-full font-mono text-xs border-border/50 bg-black/50 text-muted-foreground h-10 tracking-wider">
                  WINDOWS BUILD PENDING
                </Button>
              </div>

              <div className="border border-border/50 rounded-sm overflow-hidden bg-black/20">
                <button 
                  onClick={() => setNotesExpanded(!notesExpanded)}
                  aria-expanded={notesExpanded}
                  className="w-full flex items-center justify-between p-3 hover:bg-white/5 text-xs font-mono text-foreground border-b border-border/50 transition-colors"
                >
                  <span className="flex items-center gap-2 tracking-widest uppercase">
                    <ListTree className="w-3 h-3 text-primary" />
                    Current Release Notes
                  </span>
                  {notesExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                </button>
                {notesExpanded && (
                  <div className="p-4 text-[11px] font-mono text-muted-foreground space-y-4">
                    <div>
                      <p className="text-foreground border-b border-border/30 pb-1 mb-2 font-bold tracking-wide">Phase 1: Simulation Harness</p>
                      <ul className="list-disc pl-4 space-y-1.5 marker:text-primary/50">
                        <li>Simulation Mode and guided engineering workflow.</li>
                        <li>WT32-ETH01 target architecture and EtherNet/IP interface framework.</li>
                        <li>Versioned Device Profiles and generated firmware integration packages.</li>
                        <li>Timer/runtime testing, automated validation, and stress testing.</li>
                        <li>Protocol Inspector, firmware update simulation, logs, reports, and support bundles.</li>
                        <li>Real Hardware Mode remains awaiting firmware implementation and final CIP mappings.</li>
                      </ul>
                    </div>
                    <div>
                      <p className="text-foreground border-b border-border/30 pb-1 mb-2 font-bold tracking-wide">Capabilities & Limitations</p>
                      <ul className="list-disc pl-4 space-y-1.5 marker:text-primary/50">
                        <li>The web application cannot directly discover arbitrary devices on a private local network.</li>
                        <li>Disabled future capabilities remain outside the active Phase 1 implementation checklist.</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/50 backdrop-blur">
            <button 
              onClick={() => setPreviousExpanded(!previousExpanded)}
              aria-expanded={previousExpanded}
              className="w-full flex items-center justify-between p-4 hover:bg-white/5 text-xs font-mono text-foreground transition-colors"
            >
              <span className="flex items-center gap-2 tracking-widest uppercase text-muted-foreground">
                Previous Releases
              </span>
              {previousExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </button>
            {previousExpanded && (
              <CardContent className="pt-0 pb-4">
                <div className="border border-dashed border-border/50 p-6 text-center text-[10px] font-mono text-muted-foreground bg-black/20 tracking-widest leading-relaxed">
                  NO PREVIOUS RELEASES AVAILABLE.<br/>THIS IS THE INITIAL VERSION.
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Right Column: Firmware Integration & Workflow */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          <Card className="border-border bg-card/50 backdrop-blur">
            <CardHeader data-tour="downloads-package" className="border-b border-border/50 bg-black/20 pb-4">
              <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
                <PackageOpen className="w-4 h-4" />
                Firmware Integration Package
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              
              <div className="flex flex-col md:flex-row gap-8 items-start">
                
                <div className="flex-1 space-y-6 w-full">
                  <div className="text-[11px] font-mono text-muted-foreground leading-relaxed border-l-2 border-primary/50 pl-3">
                    This package provides the canonical external LSN communications interface for firmware implementation. 
                    It translates the active Device Profile into portable C/C++ definitions, interface specifications, and validation checklists.
                  </div>

                  <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                    <div className="border border-border/70 p-3 bg-black/20">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Active Interface</div>
                      <div className="mt-1 text-foreground font-bold">{packageSummary.activeFieldCount} FIELDS</div>
                    </div>
                    <div className="border border-border/70 p-3 bg-black/20">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Protocol Mapping</div>
                      <div className="mt-1 flex gap-4 font-bold">
                        <span className="text-success">{packageSummary.mappedFieldCount} MAPPED</span>
                        <span className={packageSummary.tbdFieldCount > 0 ? "text-warning" : "text-muted-foreground"}>
                          {packageSummary.tbdFieldCount} TBD
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 font-mono text-[10px]">
                    <div className="border border-border/70 p-3 bg-black/20">
                      <div className="mb-2 uppercase tracking-widest text-muted-foreground">Firmware Status</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(packageSummary.firmwareStatuses).map(([status, count]) => (
                          <span key={status} className="border border-border/50 bg-black/30 px-1.5 py-0.5 rounded-sm">
                            {status}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="border border-border/70 p-3 bg-black/20">
                      <div className="mb-2 uppercase tracking-widest text-muted-foreground">Simulation Status</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(packageSummary.simulationStatuses).map(([status, count]) => (
                          <span key={status} className="border border-border/50 bg-black/30 px-1.5 py-0.5 rounded-sm">
                            {status}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {packageSummary.tbdFieldCount > 0 && (
                    <div className="border border-warning/40 bg-warning/10 p-3 text-[11px] font-mono text-warning flex items-start gap-3 rounded-sm">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <strong className="tracking-wide">UNRESOLVED MAPPINGS DETECTED</strong>
                        <div className="mt-1.5 opacity-80 leading-relaxed">
                          This package contains unresolved protocol mappings. These entries are intentionally marked TBD for firmware implementation.
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="pt-2" aria-live="polite" aria-atomic="true">
                    <Button 
                      onClick={handleZipDownload}
                      disabled={zipState === 'generating'}
                      className={`w-full font-mono text-xs tracking-wider h-12 transition-colors ${
                        zipState === 'ready' ? 'border-success text-success hover:bg-success/10 bg-success/10' :
                        zipState === 'error' ? 'border-destructive text-destructive hover:bg-destructive/10 bg-destructive/5' :
                        'border-primary/60 text-primary hover:bg-primary/10 bg-primary/5'
                      }`}
                      variant="outline"
                    >
                      {zipState === 'generating' ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> GENERATING...</>
                      ) : zipState === 'error' ? (
                        <><AlertTriangle className="w-4 h-4 mr-2" /> DOWNLOAD FAILED (RETRY)</>
                      ) : zipState === 'ready' ? (
                        <><CheckCircle2 className="w-4 h-4 mr-2" /> DOWNLOAD READY (GENERATE AGAIN)</>
                      ) : (
                        <><Download className="w-4 h-4 mr-2" /> GENERATE & DOWNLOAD PACKAGE</>
                      )}
                    </Button>
                    
                    {zipState === 'error' && zipError && (
                      <div className="mt-3 text-[10px] text-destructive font-mono border border-destructive/30 bg-destructive/10 p-3 rounded-sm" role="alert">
                        <strong className="block mb-1">Generation Error:</strong> {zipError}
                      </div>
                    )}
                    
                    {zipState === 'ready' && zipHash && (
                      <div className="mt-3 text-[10px] text-muted-foreground font-mono bg-black/20 p-3 border border-border/50 flex flex-col gap-1 rounded-sm">
                        <span className="uppercase text-[9px] tracking-widest text-foreground">SHA-256 Checksum</span>
                        <span className="break-all">{zipHash}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-full md:w-56 shrink-0 flex flex-col gap-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 pb-2 border-b border-border/50">
                    Individual Resources
                  </div>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled={isGeneratingItem !== null}
                    onClick={() => handleIndividualDownload('lsn_protocol.h', 'text/plain')}
                    className="justify-start font-mono text-[10px] h-8 bg-black/30 border-border/50 text-foreground hover:border-primary/50 transition-colors"
                  >
                    {isGeneratingItem === 'lsn_protocol.h' ? <Loader2 className="w-3 h-3 mr-2 text-primary animate-spin" /> : <FileCode2 className="w-3 h-3 mr-2 text-primary" />}
                    lsn_protocol.h
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled={isGeneratingItem !== null}
                    onClick={() => handleIndividualDownload('lsn_protocol_types.h', 'text/plain')}
                    className="justify-start font-mono text-[10px] h-8 bg-black/30 border-border/50 text-foreground hover:border-primary/50 transition-colors"
                  >
                    {isGeneratingItem === 'lsn_protocol_types.h' ? <Loader2 className="w-3 h-3 mr-2 text-primary animate-spin" /> : <FileCode2 className="w-3 h-3 mr-2 text-primary" />}
                    lsn_protocol_types.h
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled={isGeneratingItem !== null}
                    onClick={() => handleIndividualDownload('lsn_protocol_profile.json', 'application/json')}
                    className="justify-start font-mono text-[10px] h-8 bg-black/30 border-border/50 text-foreground hover:border-primary/50 transition-colors"
                  >
                    {isGeneratingItem === 'lsn_protocol_profile.json' ? <Loader2 className="w-3 h-3 mr-2 text-secondary-foreground animate-spin" /> : <FileJson className="w-3 h-3 mr-2 text-secondary-foreground" />}
                    lsn_protocol_profile.json
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled={isGeneratingItem !== null}
                    onClick={() => handleIndividualDownload('lsn_interface.md', 'text/markdown')}
                    className="justify-start font-mono text-[10px] h-8 bg-black/30 border-border/50 text-foreground hover:border-primary/50 transition-colors"
                  >
                    {isGeneratingItem === 'lsn_interface.md' ? <Loader2 className="w-3 h-3 mr-2 text-muted-foreground animate-spin" /> : <FileText className="w-3 h-3 mr-2 text-muted-foreground" />}
                    lsn_interface.md
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled={isGeneratingItem !== null}
                    onClick={() => handleIndividualDownload('lsn_interface.csv', 'text/csv')}
                    className="justify-start font-mono text-[10px] h-8 bg-black/30 border-border/50 text-foreground hover:border-primary/50 transition-colors"
                  >
                    {isGeneratingItem === 'lsn_interface.csv' ? <Loader2 className="w-3 h-3 mr-2 text-muted-foreground animate-spin" /> : <Table className="w-3 h-3 mr-2 text-muted-foreground" />}
                    lsn_interface.csv
                  </Button>
                  {itemError && (
                    <div className="mt-2 border border-destructive/30 bg-destructive/10 p-2 text-[10px] font-mono text-destructive" role="alert">
                      DOWNLOAD FAILED · {itemError}
                    </div>
                  )}
                </div>

              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/50 backdrop-blur">
            <CardHeader data-tour="downloads-workflow" className="border-b border-border/50 bg-black/20 pb-4">
              <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
                <Info className="w-4 h-4" />
                Recommended Development Workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="relative pl-4 border-l border-border/50 space-y-6 ml-4">
                
                {WORKFLOW_STEPS.map((step, idx) => (
                  <div key={idx} className="relative">
                    <div className={`absolute -left-[33px] top-0 w-8 h-8 rounded-full bg-card border-2 flex items-center justify-center shrink-0 font-mono text-xs font-bold shadow-[0_0_10px_rgba(0,0,0,0.5)] ${idx === 7 ? 'border-warning text-warning' : 'border-primary text-primary'}`}>
                      {idx + 1}
                    </div>
                    <div className={`border p-4 rounded-sm ml-2 ${idx === 7 ? 'border-warning/30 bg-warning/5' : 'border-border/50 bg-black/40'}`}>
                      <h4 className={`font-mono text-xs font-bold mb-1.5 uppercase tracking-wide ${idx === 7 ? 'text-warning' : 'text-foreground'}`}>
                        {step.title}
                      </h4>
                      <p className={`text-[11px] font-mono leading-relaxed ${idx === 7 ? 'text-warning/80' : 'text-muted-foreground'}`}>
                        {step.desc}
                      </p>
                    </div>
                  </div>
                ))}

              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
