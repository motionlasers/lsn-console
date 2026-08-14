import { useStore, ImplementationStatus, SimulationStatus, effectiveFirmwareStatus, isProfileItemSupported } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileJson, CheckCircle2, Clock, AlertTriangle, FileCode2, Download, Upload } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { generateMarkdownProfile, downloadFile } from "@/lib/exports";
import { useRef, useState } from "react";

export default function Profile() {
  const { profile, settings, updateProfileItem, importProfile, capabilities, setCapability, mode } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{success?: boolean, msg?: string}>({});

  const supportedProfile = profile.filter(item => isProfileItemSupported(item, capabilities));

  const handleExport = () => {
    const md = generateMarkdownProfile(supportedProfile);
    downloadFile(md, 'lsn-interface-specification.md', 'text/markdown');
  };

  const handleImportClick = () => fileInputRef.current?.click();

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
      
      {settings.devMode && mode === 'simulation' && <Card className="border-warning/40 bg-warning/5 backdrop-blur">
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

      <Card className="border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <FileJson className="w-4 h-4" />
            Active Profile Specification
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="text-[10px] font-mono text-muted-foreground text-right">
              <div>PROTOCOL MAPPING: <span className="text-warning">TBD</span></div>
              <div>HARDWARE VALIDATION: <span className="text-warning">REQUIRED</span></div>
            </div>
            
            <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileChange} />
            <Button variant="outline" size="sm" onClick={handleImportClick} className="h-7 text-[10px] font-mono border-border text-foreground hover:bg-white/10">
              <Upload className="w-3 h-3 mr-2" /> IMPORT JSON
            </Button>
            
            <Button variant="outline" size="sm" onClick={handleExport} className="h-7 text-[10px] font-mono border-primary text-primary hover:bg-primary/20">
              <Download className="w-3 h-3 mr-2" /> EXPORT SPEC (MD)
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
                  <TableCell className="text-muted-foreground text-[10px] max-w-[200px]" title={item.expectedFirmwareBehavior}>
                    {item.expectedFirmwareBehavior}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
