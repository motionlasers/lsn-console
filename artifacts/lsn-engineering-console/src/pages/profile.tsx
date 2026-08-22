import { useStore, isProfileItemSupported } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, Download, Upload, PackageOpen, GitCommit, GitBranch, ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateMarkdownProfile, downloadFile } from "@/lib/exports";
import { useEffect, useMemo, useRef, useState } from "react";
import { summarizeFirmwarePackage } from "@/lib/firmware-package";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { governanceApi, type ImmutableProfileVersion, type ProfileDraft } from "@/lib/profile-governance-api";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/hooks/use-roles";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { validateDeviceProfile, type DeviceProfileDocument } from "@/lib/profile-validation";
import { DeviceProfileEditor } from "@/components/profile/device-profile-editor";
import { FirmwarePackageDialog } from "@/components/profile/firmware-package-dialog";

export default function Profile() {
  const {
    profile,
    activeProfileDocument,
    importProfile,
    capabilities,
  } = useStore();
  const { user } = useAuth();
  const { isFirmwareAdmin, isSuperadmin } = useRoles();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{success?: boolean, msg?: string}>({});
  const [handoffOpen, setHandoffOpen] = useState(false);

  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [publishVersionId, setPublishVersionId] = useState<number | null>(null);

  // The editor is hydrated from the governed server Draft once the primary
  // profile resolves. The browser store is updated only after a governed write
  // succeeds, so a stale local default cannot overwrite shared work.
  const [draftDoc, setDraftDoc] = useState<DeviceProfileDocument>(() => structuredClone(activeProfileDocument));
  const [draftConflict, setDraftConflict] = useState<string | null>(null);

  const draftValidation = useMemo(() => validateDeviceProfile(draftDoc), [draftDoc]);

  const supportedProfile = profile.filter(item => isProfileItemSupported(item, capabilities));
  const packageSummary = useMemo(
    () => summarizeFirmwarePackage(draftDoc, capabilities),
    [draftDoc, capabilities],
  );

  const { data: primaryProfileId } = useQuery({
    queryKey: ['primary-profile'],
    queryFn: async () => await governanceApi.getPrimaryProfileId(activeProfileDocument),
  });

  const governedDraftQuery = useQuery({
    queryKey: ['profile-draft', primaryProfileId],
    queryFn: async () => {
      if (!primaryProfileId) throw new Error("No profile available");
      const res = await governanceApi.getDraft(primaryProfileId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !!primaryProfileId && isFirmwareAdmin,
  });

  useEffect(() => {
    if (!governedDraftQuery.data) return;
    setDraftDoc(structuredClone(governedDraftQuery.data.document));
  }, [governedDraftQuery.data]);

  const canPersist = isFirmwareAdmin
    && !!governedDraftQuery.data
    && !governedDraftQuery.isFetching
    && draftValidation.valid;

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

  const { data: publications = [] } = useQuery({
    queryKey: ['profile-publications', primaryProfileId],
    queryFn: async () => {
      if (!primaryProfileId) return [];
      const res = await governanceApi.listPublications(primaryProfileId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !!primaryProfileId && isFirmwareAdmin,
  });

  const developmentPublishedVersionIds = useMemo(
    () => publications
      .filter(publication => publication.channel === 'DEVELOPMENT')
      .map(publication => publication.versionId),
    [publications],
  );

  const validatedDraftDocument = (): DeviceProfileDocument => {
    const validation = validateDeviceProfile(draftDoc);
    if (!validation.valid) {
      throw new Error(`Profile is invalid: ${validation.errors.join("; ")}`);
    }
    return structuredClone(draftDoc);
  };

  const requestError = (message: string, status?: number) => {
    const error = new Error(message) as Error & { status?: number };
    error.status = status;
    return error;
  };

  const acceptSavedDraft = (saved: ProfileDraft) => {
    qc.setQueryData(['profile-draft', primaryProfileId], saved);
    setDraftDoc(structuredClone(saved.document));
    const imported = importProfile(JSON.stringify(saved.document));
    if (!imported.success) {
      throw new Error(imported.error ?? "Saved draft could not be loaded into the local workspace");
    }
    setDraftConflict(null);
  };

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!isFirmwareAdmin) throw new Error("Firmware Admin role required");
      if (!primaryProfileId) throw new Error("No profile available");
      if (!governedDraftQuery.data) throw new Error("Governed draft is still loading");
      const document = validatedDraftDocument();
      const res = await governanceApi.saveDraft(primaryProfileId, document, governedDraftQuery.data.revision);
      if (!res.ok) throw requestError(res.error, res.status);
      return res.data;
    },
    onSuccess: (saved) => {
      acceptSavedDraft(saved);
      toast({ title: "Working draft saved successfully." });
    },
    onError: async (err: Error & { status?: number }) => {
      if (err.status === 409) {
        setDraftConflict("This draft changed in another session. The latest governed revision has been reloaded; review it before saving again.");
        await governedDraftQuery.refetch();
      }
      toast({ title: "Failed to save draft", description: err.message, variant: "destructive" });
    },
  });

  const submitDraft = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Unauthenticated");
      if (!isFirmwareAdmin) throw new Error("Firmware Admin role required");
      if (!primaryProfileId) throw new Error("No profile available");
      if (!governedDraftQuery.data) throw new Error("Governed draft is still loading");

      const document = validatedDraftDocument();
      const saveRes = await governanceApi.saveDraft(primaryProfileId, document, governedDraftQuery.data.revision);
      if (!saveRes.ok) throw requestError(saveRes.error, saveRes.status);
      acceptSavedDraft(saveRes.data);
      
      const submitRes = await governanceApi.submitForReview(primaryProfileId, saveRes.data.revision);
      if (!submitRes.ok) throw requestError(submitRes.error, submitRes.status);
      if (submitRes.data.draft) acceptSavedDraft(submitRes.data.draft);
      
      return submitRes.data;
    },
    onSuccess: () => {
      toast({ title: "Draft submitted for review" });
      setSubmitDialogOpen(false);
      qc.invalidateQueries({ queryKey: ['profile-versions'] });
    },
    onError: async (err: Error & { status?: number }) => {
      if (err.status === 409) {
        setDraftConflict("This draft changed in another session. The latest governed revision has been reloaded; review it before submitting again.");
        await governedDraftQuery.refetch();
      }
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
      void qc.invalidateQueries({ queryKey: ['profile-publications'] });
      toast({ title: "Profile lifecycle updated" });
    },
    onError: (err: Error) => toast({ title: "Lifecycle action failed", description: err.message, variant: "destructive" }),
  });

  const handleExport = () => {
    const md = generateMarkdownProfile(supportedProfile);
    downloadFile(md, 'lsn-interface-specification.md', 'text/markdown');
  };

  const handleImportClick = () => {
    if (!isFirmwareAdmin) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isFirmwareAdmin) {
      setImportStatus({ success: false, msg: 'Import requires the Firmware Admin role.' });
      setTimeout(() => setImportStatus({}), 5000);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        try {
          const importedDocument = JSON.parse(e.target.result as string) as DeviceProfileDocument;
          const validation = validateDeviceProfile(importedDocument);
          if (!validation.valid) {
            throw new Error(validation.errors.join("; "));
          }
          setDraftDoc(structuredClone(importedDocument));
          setDraftConflict(null);
          setImportStatus({ success: true, msg: "JSON Schema validated and loaded into the editor. Save to update the governed draft." });
        } catch (error) {
          setImportStatus({ success: false, msg: error instanceof Error ? error.message : "Invalid profile JSON" });
        }
        setTimeout(() => setImportStatus({}), 5000);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flex flex-col h-full gap-6 animate-in fade-in duration-300">
      
      <div className="flex items-center justify-between">
        <div>
           <h1 className="text-2xl font-mono text-foreground font-bold uppercase tracking-wider mb-2">Firmware Administration</h1>
           <p className="text-xs font-mono text-muted-foreground max-w-4xl leading-relaxed">
             Govern device profile evolution. Edit working mappings, submit drafts for client review, and manage immutable publication history.
           </p>
        </div>
        <div className="flex gap-2" data-tour="profile-governance-actions">
           <Button variant="outline" disabled={!canPersist || saveDraft.isPending} onClick={() => saveDraft.mutate()} className="font-mono text-xs" data-testid="button-save-governed-draft">
             {saveDraft.isPending ? "SAVING…" : "SAVE DRAFT"}
           </Button>
           <Button disabled={!canPersist} onClick={() => setSubmitDialogOpen(true)} className="font-mono text-xs font-bold" data-testid="button-submit-draft">
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
          <Card data-tour="profile-interface" className="border-border bg-card/50 backdrop-blur">
            <CardHeader className="border-b border-border/50 bg-black/20 pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-mono tracking-widest text-primary">
                  Device Profile Working Editor
                </CardTitle>
                <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                  {isFirmwareAdmin
                    ? 'Edit the complete supported Device Profile document. Save/Submit is blocked while the profile is invalid.'
                    : 'Read-only. Firmware Admin role required to edit, import, or publish the Device Profile.'}
                </p>
              </div>
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
                {isFirmwareAdmin && (
                  <Button variant="outline" size="sm" onClick={handleImportClick} className="h-7 text-[10px] font-mono border-border text-foreground hover:bg-white/10" data-testid="button-import-json">
                    <Upload className="w-3 h-3 mr-2" /> IMPORT JSON
                  </Button>
                )}

                <Button variant="outline" size="sm" onClick={handleExport} className="h-7 text-[10px] font-mono border-primary text-primary hover:bg-primary/20" data-testid="button-export-spec">
                  <Download className="w-3 h-3 mr-2" /> EXPORT SPEC (MD)
                </Button>

                <Button
                  data-tour="profile-export"
                  variant="outline"
                  size="sm"
                  onClick={() => setHandoffOpen(true)}
                  className="h-7 text-[10px] font-mono border-success/60 text-success hover:bg-success/10"
                  data-testid="button-open-firmware-package"
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

            {draftConflict && (
              <div className="px-6 py-3 text-xs font-mono border-b border-warning/40 bg-warning/10 text-warning" data-testid="alert-draft-conflict">
                <AlertTriangle className="w-3 h-3 inline mr-2" />
                {draftConflict}
              </div>
            )}

            <CardContent className="pt-4">
              {/* data-tour="profile-capabilities": the full editor now hosts the
                  future-capability metadata controls (see Future Capabilities card). */}
              <div data-tour="profile-capabilities">
                {governedDraftQuery.isLoading && (
                  <div className="py-12 text-center text-xs font-mono text-muted-foreground" data-testid="governed-draft-loading">
                    Loading governed draft…
                  </div>
                )}
                {governedDraftQuery.isError && (
                  <div className="py-12 text-center text-xs font-mono text-destructive" data-testid="governed-draft-error">
                    Failed to load the governed draft. Refresh before editing.
                  </div>
                )}
                {!governedDraftQuery.isLoading && !governedDraftQuery.isError && (
                <DeviceProfileEditor
                  document={draftDoc}
                  onChange={(next) => {
                    setDraftDoc(next);
                    setDraftConflict(null);
                  }}
                  readOnly={!isFirmwareAdmin}
                />
                )}
              </div>
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

      <FirmwarePackageDialog
        open={handoffOpen}
        onOpenChange={setHandoffOpen}
        versions={versions}
        developmentPublishedVersionIds={developmentPublishedVersionIds}
      />
      
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
