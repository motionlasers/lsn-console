import { useStore, ImplementationStatus, SimulationStatus, effectiveFirmwareStatus, isProfileItemSupported } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileJson, CheckCircle2, Clock, AlertTriangle, FileCode2, Download, Upload, PackageOpen, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { generateMarkdownProfile, downloadBlob, downloadFile } from "@/lib/exports";
import { useMemo, useRef, useState } from "react";
import {
  createFirmwareIntegrationPackage,
  summarizeFirmwarePackage,
} from "@/lib/firmware-package";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Profile() {
  const {
    profile,
    activeProfileDocument,
    settings,
    updateProfileItem,
    importProfile,
    capabilities,
    setCapability,
    mode,
  } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{success?: boolean, msg?: string}>({});
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [isExportingPackage, setIsExportingPackage] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);

  const supportedProfile = profile.filter(item => isProfileItemSupported(item, capabilities));
  const packageSummary = useMemo(
    () => summarizeFirmwarePackage(activeProfileDocument, capabilities),
    [activeProfileDocument, capabilities],
  );

  const handleExport = () => {
    const md = generateMarkdownProfile(supportedProfile);
    downloadFile(md, 'lsn-interface-specification.md', 'text/markdown');
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFirmwarePackageExport = async () => {
    setIsExportingPackage(true);
    setPackageError(null);
    try {
      const result = await createFirmwareIntegrationPackage(activeProfileDocument, capabilities);
      downloadBlob(result.blob, result.filename);
      setHandoffOpen(false);
    } catch (error) {
      setPackageError(error instanceof Error ? error.message : 'Package generation failed.');
    } finally {
      setIsExportingPackage(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        const res = importProfile(e.target.result as string);
        if (res.success) {
          setImportStatus({ success: true, msg: res.message || "JSON Schema validated and profile imported." });
        } else {
          setImportStatus({ success: false, msg: res.error });
        }
        setTimeout(() => setImportStatus({}), 5000);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'VERIFIED': return 'text-success bg-success/10 border-success/20';
      case 'IMPLEMENTED': return 'text-primary bg-primary/10 border-primary/20';
      case 'TESTING': return 'text-warning bg-warning/10 border-warning/20';
      case 'IMPLEMENTING': return 'text-secondary-foreground bg-secondary border-secondary-border';
      default: return 'text-muted-foreground bg-muted border-border';
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'VERIFIED': return <CheckCircle2 className="w-3 h-3" />;
      case 'IMPLEMENTED': return <CheckCircle2 className="w-3 h-3" />;
      case 'TESTING': return <Clock className="w-3 h-3" />;
      case 'IMPLEMENTING': return <FileCode2 className="w-3 h-3" />;
      default: return <AlertTriangle className="w-3 h-3" />;
    }
  };

  const statusOptions: ImplementationStatus[] = ['TBD', 'IMPLEMENTING', 'TESTING', 'IMPLEMENTED', 'VERIFIED'];
  const simulationStatusOptions: SimulationStatus[] = ['NOT_TESTED', 'TESTING', 'VERIFIED'];

  return (
    <div className="flex flex-col h-full gap-6 animate-in fade-in duration-300">
      
      {settings.devMode && mode === 'simulation' && <Card data-tour="profile-capabilities" className="border-warning/40 bg-warning/5 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
             Simulation / Developer Experimental Capabilities
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 flex gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest">Interlock</span>
            <span className={`font-mono text-xs ${capabilities?.interlock ? 'text-success' : 'text-muted-foreground'}`}>{capabilities?.interlock ? 'ENABLED' : 'DISABLED'}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest">Remote Stop</span>
            <span className={`font-mono text-xs ${capabilities?.remoteStop ? 'text-success' : 'text-muted-foreground'}`}>{capabilities?.remoteStop ? 'ENABLED' : 'DISABLED'}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest">Sensors</span>
            <span className={`font-mono text-xs ${capabilities?.sensors ? 'text-success' : 'text-muted-foreground'}`}>{capabilities?.sensors ? 'ENABLED' : 'DISABLED'}</span>
          </div>
          
            <div className="ml-auto flex items-center gap-2 border-l border-border/50 pl-6">
              <span className="text-[10px] text-destructive uppercase font-mono tracking-widest mr-2">Dev Override:</span>
              <Button size="sm" variant="outline" onClick={() => setCapability?.('interlock', !capabilities?.interlock)} className={`h-7 text-[10px] font-mono ${capabilities?.interlock ? 'border-primary text-primary' : 'border-muted text-muted-foreground'}`}>
                INT
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCapability?.('remoteStop', !capabilities?.remoteStop)} className={`h-7 text-[10px] font-mono ${capabilities?.remoteStop ? 'border-primary text-primary' : 'border-muted text-muted-foreground'}`}>
                REM
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCapability?.('sensors', !capabilities?.sensors)} className={`h-7 text-[10px] font-mono ${capabilities?.sensors ? 'border-primary text-primary' : 'border-muted text-muted-foreground'}`}>
                SEN
              </Button>
            </div>
        </CardContent>
      </Card>}

      <Card data-tour="profile-interface" className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <FileJson className="w-4 h-4" />
            Active Profile Specification
          </CardTitle>
          <div data-tour="profile-export" className="flex flex-wrap items-center justify-end gap-3">
            <div className="text-[10px] font-mono text-muted-foreground text-right">
              <div>
                PROTOCOL MAPPING:{' '}
                <span className={packageSummary.tbdFieldCount > 0 ? "text-warning" : "text-success"}>
                  {packageSummary.mappedFieldCount}/{packageSummary.activeFieldCount} RESOLVED
                </span>
              </div>
              <div>HARDWARE VALIDATION: <span className="text-warning">REQUIRED</span></div>
            </div>
            
            <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileChange} />
            <Button variant="outline" size="sm" onClick={handleImportClick} className="h-7 text-[10px] font-mono border-border text-foreground hover:bg-white/10">
              <Upload className="w-3 h-3 mr-2" /> IMPORT JSON
            </Button>
            
            <Button variant="outline" size="sm" onClick={handleExport} className="h-7 text-[10px] font-mono border-primary text-primary hover:bg-primary/20">
              <Download className="w-3 h-3 mr-2" /> EXPORT SPEC (MD)
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPackageError(null);
                setHandoffOpen(true);
              }}
              className="h-7 text-[10px] font-mono border-success/60 text-success hover:bg-success/10"
              data-testid="button-export-firmware-package"
            >
              <PackageOpen className="w-3 h-3 mr-2" /> EXPORT FIRMWARE INTEGRATION PACKAGE
            </Button>
          </div>
        </CardHeader>
        
        {importStatus.msg && (
          <div className={`px-6 py-2 text-xs font-mono border-b border-border/50 ${importStatus.success ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
             {importStatus.success ? <CheckCircle2 className="w-3 h-3 inline mr-2"/> : <AlertTriangle className="w-3 h-3 inline mr-2"/>}
             {importStatus.msg} 
          </div>
        )}

        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-card">
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="font-mono text-[10px] text-muted-foreground">SYMBOLIC NAME</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground">DIR / TYPE</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground">CIP REF</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground">FIRMWARE STATUS</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground">SIMULATION STATUS</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground">EXPECTED FW BEHAVIOR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-xs">
              {supportedProfile.map(item => (
                <TableRow key={item.id} className="border-border/20 hover:bg-white/5">
                  <TableCell className="font-bold text-foreground/90">
                    {item.symbolicName}
                    <div className="text-[10px] font-normal text-muted-foreground mt-0.5 max-w-xs">{item.notes}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-foreground/80">{item.direction.toUpperCase()}</div>
                    <div className="text-[10px] text-primary">{item.dataType} ({item.access.toUpperCase()})</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    Class: {item.class} <br/>
                    Inst: {item.instance} <br/>
                    Attr: {item.attribute}
                  </TableCell>
                  <TableCell>
                    {settings.devMode ? (
                      <select 
                        value={effectiveFirmwareStatus(item)}
                        onChange={(e) => updateProfileItem(item.id, { implementationStatus: e.target.value as ImplementationStatus })}
                        disabled={effectiveFirmwareStatus(item) === 'TBD'}
                        title={effectiveFirmwareStatus(item) === 'TBD' ? 'Firmware status remains TBD until protocol mappings are resolved.' : undefined}
                        className={`bg-black border rounded-sm text-[10px] font-mono p-1 focus:outline-none disabled:opacity-70 ${statusColor(effectiveFirmwareStatus(item))}`}
                      >
                        {statusOptions.map(opt => <option key={opt} value={opt} className="bg-background text-foreground">{opt}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 border rounded-sm text-[10px] tracking-wider ${statusColor(effectiveFirmwareStatus(item))}`}>
                        {statusIcon(effectiveFirmwareStatus(item))}
                        {effectiveFirmwareStatus(item)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {settings.devMode ? (
                      <select
                        value={item.simulationStatus}
                        onChange={(e) => updateProfileItem(item.id, { simulationStatus: e.target.value as SimulationStatus })}
                        className={`bg-black border rounded-sm text-[10px] font-mono p-1 focus:outline-none ${statusColor(item.simulationStatus)}`}
                      >
                        {simulationStatusOptions.map(opt => <option key={opt} value={opt} className="bg-background text-foreground">{opt}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 border rounded-sm text-[10px] tracking-wider ${statusColor(item.simulationStatus)}`}>
                        {statusIcon(item.simulationStatus)}
                        {item.simulationStatus}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-[10px] max-w-[200px]" title={item.expectedFirmwareBehavior}>
                    {item.expectedFirmwareBehavior}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={handoffOpen} onOpenChange={setHandoffOpen}>
        <DialogContent className="max-w-2xl border-border bg-background">
          <DialogHeader>
            <DialogTitle className="font-mono text-base tracking-wider text-primary flex items-center gap-2">
              <PackageOpen className="h-5 w-5" />
              Firmware Integration Package
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              Review the active Device Profile summary before generating the ESP-IDF / C/C++ handoff ZIP.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 font-mono text-xs" data-testid="firmware-package-summary">
            <div className="border border-border bg-card/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Active Profile</div>
              <div className="mt-1 text-foreground">{packageSummary.profileVersion}</div>
            </div>
            <div className="border border-border bg-card/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Protocol Version</div>
              <div className="mt-1 text-foreground">{packageSummary.protocolVersion}</div>
            </div>
            <div className="border border-border bg-card/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Protocol Mapping</div>
              <div className="mt-1 flex gap-4">
                <span className="text-success">{packageSummary.mappedFieldCount} MAPPED</span>
                <span className={packageSummary.tbdFieldCount > 0 ? "text-warning" : "text-muted-foreground"}>
                  {packageSummary.tbdFieldCount} TBD
                </span>
              </div>
            </div>
            <div className="border border-border bg-card/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Active Interface</div>
              <div className="mt-1 text-foreground">{packageSummary.activeFieldCount} FIELDS</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 font-mono text-[10px]">
            <div className="border border-border/70 p-3">
              <div className="mb-2 uppercase tracking-widest text-muted-foreground">Firmware Status</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(packageSummary.firmwareStatuses).map(([status, count]) => (
                  <span key={status} className="border border-border bg-muted/30 px-2 py-1">
                    {status}: {count}
                  </span>
                ))}
              </div>
            </div>
            <div className="border border-border/70 p-3">
              <div className="mb-2 uppercase tracking-widest text-muted-foreground">Simulation Status</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(packageSummary.simulationStatuses).map(([status, count]) => (
                  <span key={status} className="border border-border bg-muted/30 px-2 py-1">
                    {status}: {count}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {packageSummary.tbdFieldCount > 0 && (
            <div
              className="border border-warning/40 bg-warning/10 p-3 text-xs font-mono text-warning"
              data-testid="firmware-package-tbd-warning"
            >
              <AlertTriangle className="mr-2 inline h-4 w-4" />
              This package contains unresolved protocol mappings. These entries are intentionally marked TBD for firmware implementation.
            </div>
          )}

          <div className="text-[11px] font-mono leading-relaxed text-muted-foreground">
            The ZIP includes portable headers, the complete active profile JSON, CSV and Markdown checklists,
            and a practical README. Missing enum values, string layouts, byte/bit packing, GPIO assignments,
            and CIP values are never inferred.
          </div>

          {packageError && (
            <div className="border border-destructive/40 bg-destructive/10 p-3 text-xs font-mono text-destructive">
              {packageError}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setHandoffOpen(false)}
              disabled={isExportingPackage}
              className="font-mono text-xs"
            >
              CANCEL
            </Button>
            <Button
              onClick={handleFirmwarePackageExport}
              disabled={isExportingPackage}
              className="font-mono text-xs"
              data-testid="button-confirm-firmware-package"
            >
              {isExportingPackage ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> GENERATING ZIP</>
              ) : (
                <><Download className="mr-2 h-4 w-4" /> GENERATE & DOWNLOAD ZIP</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
