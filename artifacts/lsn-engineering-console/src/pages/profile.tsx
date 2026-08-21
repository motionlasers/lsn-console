import { useStore, ImplementationStatus, SimulationStatus, effectiveFirmwareStatus, isProfileItemSupported } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileJson, CheckCircle2, Clock, AlertTriangle, FileCode2, Download, Upload, PackageOpen, Loader2, GitCommit, GitBranch, ArrowLeft, Send } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { generateMarkdownProfile, downloadBlob, downloadFile } from "@/lib/exports";
import { useMemo, useRef, useState } from "react";
import { createFirmwareIntegrationPackage, summarizeFirmwarePackage } from "@/lib/firmware-package";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { governanceApi, type ImmutableProfileVersion } from "@/lib/profile-governance-api";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/hooks/use-roles";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

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
  const { user } = useAuth();
  const { isFirmwareAdmin, isSuperadmin } = useRoles();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{success?: boolean, msg?: string}>({});
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [isExportingPackage, setIsExportingPackage] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [publishVersionId, setPublishVersionId] = useState<number | null>(null);

  const supportedProfile = profile.filter(item => isProfileItemSupported(item, capabilities));
  const packageSummary = useMemo(
    () => summarizeFirmwarePackage(activeProfileDocument, capabilities),
    [activeProfileDocument, capabilities],
  );

  const { data: primaryProfileId } = useQuery({
    queryKey: ['primary-profile'],
    queryFn: async () => await governanceApi.getPrimaryProfileId(activeProfileDocument),
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['profile-versions', primaryProfileId],
    queryFn: async () => {
      if (!primaryProfileId) return [];
      const res = await governanceApi.listVersions(primaryProfileId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !!primaryProfileId
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!primaryProfileId) throw new Error("No profile available");
      const res = await governanceApi.saveDraft(primaryProfileId, activeProfileDocument);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Working draft saved successfully." });
    },
    onError: (err: any) => toast({ title: "Failed to save draft", description: err.message, variant: "destructive" })
  });

  const submitDraft = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Unauthenticated");
      if (!primaryProfileId) throw new Error("No profile available");
      
      // Save current working copy first
      const saveRes = await governanceApi.saveDraft(primaryProfileId, activeProfileDocument);
      if (!saveRes.ok) throw new Error(saveRes.error);
      
      const submitRes = await governanceApi.submitForReview(primaryProfileId);
      if (!submitRes.ok) throw new Error(submitRes.error);
      
      return submitRes.data;
    },
    onSuccess: () => {
      toast({ title: "Draft submitted for review" });
      setSubmitDialogOpen(false);
      qc.invalidateQueries({ queryKey: ['profile-versions'] });
    },
    onError: (err: any) => {
      toast({ title: "Submit failed", description: err.message, variant: "destructive" });
    }
  });

  const rollback = useMutation({
    mutationFn: async (versionId: number) => {
      if (!primaryProfileId) throw new Error("No profile available");
      const res = await governanceApi.rollbackDevelopment(primaryProfileId, versionId);
      if (!res.ok) throw new Error(res.error);
      
      const v = versions.find((v: ImmutableProfileVersion) => v.id === versionId);
      if (v) importProfile(JSON.stringify(v.document));
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Rolled back working profile" });
      qc.invalidateQueries({ queryKey: ['profile-versions'] });
    },
    onError: (err: any) => toast({ title: "Rollback failed", description: err.message, variant: "destructive" })
  });

  const { data: publishDetails } = useQuery({
    queryKey: ['profile-version', publishVersionId],
    queryFn: async () => {
      const res = await governanceApi.getVersion(publishVersionId!);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: publishVersionId !== null,
  });

  const lifecycle = useMutation({
    mutationFn: async ({ action, versionId }: { action: 'publish' | 'simulation' | 'hardware' | 'production'; versionId: number }) => {
      const result = action === 'publish'
        ? await governanceApi.publishDevelopment(versionId)
        : action === 'simulation'
          ? await governanceApi.recordSimulation(versionId, true, { source: 'console-simulation', recordedAt: new Date().toISOString() })
          : action === 'hardware'
            ? await governanceApi.recordHardwareVerification(versionId, true, { source: 'guided-hardware-validation', recordedAt: new Date().toISOString() })
            : await governanceApi.promoteProduction(versionId);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      setPublishVersionId(null);
      void qc.invalidateQueries({ queryKey: ['profile-versions'] });
      toast({ title: "Profile lifecycle updated" });
    },
    onError: (err: Error) => toast({ title: "Lifecycle action failed", description: err.message, variant: "destructive" }),
  });

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
      
      <div className="flex items-center justify-between">
        <div>
           <h1 className="text-2xl font-mono text-foreground font-bold uppercase tracking-wider mb-2">Firmware Administration</h1>
           <p className="text-xs font-mono text-muted-foreground max-w-4xl leading-relaxed">
             Govern device profile evolution. Edit working mappings, submit drafts for client review, and manage immutable publication history.
           </p>
        </div>
        <div className="flex gap-2">
           <Button variant="outline" disabled={!isFirmwareAdmin || saveDraft.isPending} onClick={() => saveDraft.mutate()} className="font-mono text-xs" data-testid="button-save-governed-draft">
             {saveDraft.isPending ? "SAVING…" : "SAVE DRAFT"}
           </Button>
           <Button disabled={!isFirmwareAdmin} onClick={() => setSubmitDialogOpen(true)} className="font-mono text-xs font-bold" data-testid="button-submit-draft">
             <Send className="w-4 h-4 mr-2" /> SUBMIT WORKING DRAFT
           </Button>
        </div>
      </div>

      <Tabs defaultValue="editor" className="w-full">
        <TabsList className="bg-black/20 border border-border/50 rounded-sm font-mono h-10 w-fit">
          <TabsTrigger value="editor" className="text-xs tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            WORKING EDITOR
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            VERSION HISTORY
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="mt-6 flex flex-col gap-6">
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
              <div className="flex flex-wrap items-center justify-end gap-3">
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
                  data-tour="profile-export"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPackageError(null);
                    setHandoffOpen(true);
                  }}
                  className="h-7 text-[10px] font-mono border-success/60 text-success hover:bg-success/10"
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
        </TabsContent>

        <TabsContent value="history" className="mt-6 flex flex-col gap-4">
          {versions.map((v: ImmutableProfileVersion) => (
            <Card key={v.id} className="border-border bg-card/50 backdrop-blur">
              <CardContent className="p-4 flex gap-4">
                 <div className="shrink-0 pt-1">
                   {v.state === 'PRODUCTION_FROZEN' ? (
                     <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary border border-primary/50">
                       <GitCommit className="w-4 h-4" />
                     </div>
                   ) : (
                     <div className="w-8 h-8 rounded-full bg-muted/20 flex items-center justify-center text-muted-foreground border border-border">
                       <GitBranch className="w-4 h-4" />
                     </div>
                   )}
                 </div>
                 <div className="flex-1 min-w-0">
                   <div className="flex items-center justify-between mb-1">
                     <div className="flex items-center gap-2">
                       <span className="font-mono text-sm font-bold text-foreground">
                         Version {v.versionNumber}
                       </span>
                       <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border rounded-sm ${
                         v.state === 'PRODUCTION_FROZEN' ? 'text-success border-success/30 bg-success/10' :
                         v.state === 'CLIENT_REVIEW' ? 'text-warning border-warning/30 bg-warning/10' :
                         v.state === 'REJECTED' ? 'text-destructive border-destructive/30 bg-destructive/10' :
                         'text-muted-foreground border-border bg-muted/20'
                       }`}>
                         {v.state}
                       </span>
                     </div>
                     <span className="font-mono text-[10px] text-muted-foreground">
                       {format(new Date(v.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                     </span>
                   </div>
                   <div className="font-mono text-xs text-muted-foreground mb-3 break-words whitespace-pre-wrap">
                     {v.state === 'DRAFT' ? 'Working copy snapshot' : 'Governance milestone'}
                   </div>
                   
                   <div className="flex gap-4 items-center bg-black/30 p-2 rounded-sm border border-border/50">
                     <div className="flex flex-col gap-1 flex-1">
                       <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Digest</span>
                       <span className="font-mono text-[10px] text-primary break-all">{v.digest}</span>
                     </div>
                     <div className="shrink-0 flex gap-2">
                       <Button 
                         variant="outline" 
                         size="sm" 
                         className="h-7 text-[10px] font-mono"
                         onClick={() => {
                           if (confirm("Replace current working editor with this version? Any unsaved changes will be lost.")) {
                             rollback.mutate(v.id);
                           }
                         }}
                         data-testid={`button-rollback-${v.id}`}
                       >
                          <ArrowLeft className="w-3 h-3 mr-2" /> ROLLBACK DEV
                       </Button>
                        {v.state === 'CLIENT_REVIEW_ACCEPTED' && (
                          <Button
                            size="sm"
                            className="h-7 text-[10px] font-mono"
                            onClick={() => setPublishVersionId(v.id)}
                            data-testid={`button-publish-${v.id}`}
                          >
                            PUBLISH DEV
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px] font-mono"
                          onClick={() => lifecycle.mutate({ action: 'simulation', versionId: v.id })}
                          data-testid={`button-simulation-evidence-${v.id}`}
                        >
                          SIM EVIDENCE
                        </Button>
                        {v.state === 'DEVELOPMENT_PUBLISHED' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] font-mono"
                            onClick={() => lifecycle.mutate({ action: 'hardware', versionId: v.id })}
                            data-testid={`button-hardware-evidence-${v.id}`}
                          >
                            HARDWARE VERIFIED
                          </Button>
                        )}
                        {isSuperadmin && v.state === 'HARDWARE_VERIFIED' && (
                          <Button
                            size="sm"
                            className="h-7 text-[10px] font-mono"
                            onClick={() => lifecycle.mutate({ action: 'production', versionId: v.id })}
                            data-testid={`button-promote-${v.id}`}
                          >
                            FREEZE PROD
                          </Button>
                        )}
                     </div>
                   </div>
                 </div>
              </CardContent>
            </Card>
          ))}
          {versions.length === 0 && (
            <div className="text-center py-12 text-muted-foreground font-mono text-xs border border-dashed border-border">
              No versions found.
            </div>
          )}
        </TabsContent>
      </Tabs>

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
      
      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent className="max-w-md border-border bg-background">
          <DialogHeader>
            <DialogTitle className="font-mono text-base tracking-wider text-primary flex items-center gap-2">
              <Send className="h-5 w-5" />
              Submit Draft for Review
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              Snapshot the working profile and submit it to Client Reviewers.
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter>
             <Button variant="outline" onClick={() => setSubmitDialogOpen(false)} className="font-mono text-xs h-8">
               CANCEL
             </Button>
             <Button 
               onClick={() => submitDraft.mutate()} 
               disabled={submitDraft.isPending} 
               className="font-mono text-xs h-8"
               data-testid="button-confirm-submit"
             >
               {submitDraft.isPending ? "SUBMITTING..." : "SUBMIT DRAFT"}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishVersionId !== null} onOpenChange={(open) => !open && setPublishVersionId(null)}>
        <DialogContent className="max-w-lg border-border bg-background">
          <DialogHeader>
            <DialogTitle className="font-mono text-base text-primary">Publish Development Profile</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              Publication creates an immutable authenticated artifact for explicit Windows Console application.
            </DialogDescription>
          </DialogHeader>
          {publishDetails && (
            <div className="grid grid-cols-2 gap-3 text-xs font-mono" data-testid="development-publication-summary">
              <div className="border border-border p-3">Review status<br/><strong>{publishDetails.version.state}</strong></div>
              <div className="border border-border p-3">Digest<br/><strong className="break-all">{publishDetails.version.digest.slice(0, 16)}…</strong></div>
              <div className="border border-border p-3">Mapping complete<br/><strong>{String(publishDetails.summary.mappingComplete)}</strong></div>
              <div className="border border-border p-3">Partial profile<br/><strong>{String(publishDetails.summary.partial)}</strong></div>
              <div className="col-span-2 border border-border p-3">
                Known limitations<br/>
                <strong>{publishDetails.summary.limitations?.join("; ") || "None recorded"}</strong>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishVersionId(null)}>CANCEL</Button>
            <Button
              onClick={() => publishVersionId && lifecycle.mutate({ action: 'publish', versionId: publishVersionId })}
              disabled={!publishDetails || lifecycle.isPending}
              data-testid="button-confirm-development-publication"
            >
              CONFIRM PUBLICATION
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
