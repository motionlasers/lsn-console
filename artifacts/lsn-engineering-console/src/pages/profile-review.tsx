import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { governanceApi, Review, ReviewComment, ReviewDecision } from "@/lib/profile-governance-api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckSquare, MessageSquare, ShieldAlert, CheckCircle2, GitBranch, FlaskConical, RotateCcw, Save, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  applyInputsToSandboxDocument,
  readInputsFromSandboxDocument,
  runSandboxSimulation,
  type ReviewSandboxInputs,
  type SandboxSimulationResult,
} from "@/lib/client-review-sandbox";

export default function ProfileReview() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [newComment, setNewComment] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [sandboxInputs, setSandboxInputs] = useState<ReviewSandboxInputs | null>(null);
  const [lastSimulation, setLastSimulation] = useState<SandboxSimulationResult | null>(null);

  const { data: primaryProfileId } = useQuery({
    queryKey: ['primary-profile'],
    queryFn: async () => {
      const res = await governanceApi.listProfiles();
      if (!res.ok) throw new Error(res.error);
      return res.data[0]?.id ?? null;
    },
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['reviews', primaryProfileId],
    queryFn: async () => {
      if (!primaryProfileId) return [];
      const res = await governanceApi.listReviews(primaryProfileId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !!primaryProfileId
  });
  
  const openReviews = reviews.filter((r: Review) => r.state === 'OPEN');
  const activeReviewOverview = reviews.find(r => r.id === selectedReviewId) || openReviews[0];

  const { data: reviewDetails } = useQuery({
    queryKey: ['review', activeReviewOverview?.id],
    queryFn: async () => {
      if (!activeReviewOverview) return null;
      const res = await governanceApi.getReview(activeReviewOverview.id);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !!activeReviewOverview
  });

  const activeReview = reviewDetails?.review;
  const comments = reviewDetails?.comments || [];
  const decisions = reviewDetails?.decisions || [];

  const { data: versions = [] } = useQuery({
    queryKey: ['profile-versions', primaryProfileId],
    queryFn: async () => {
      const res = await governanceApi.listVersions(primaryProfileId!);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: primaryProfileId !== null && primaryProfileId !== undefined,
  });

  const priorVersion = activeReview
    ? versions.find((version) => version.id !== activeReview.versionId)
    : undefined;

  const { data: diff } = useQuery({
    queryKey: ['profile-review-diff', priorVersion?.id, activeReview?.versionId],
    queryFn: async () => {
      const res = await governanceApi.getDiff(priorVersion!.id, activeReview!.versionId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: Boolean(priorVersion && activeReview),
  });

  const { data: sandbox } = useQuery({
    queryKey: ['profile-sandbox', primaryProfileId, activeReview?.id],
    queryFn: async () => {
      const res = await governanceApi.getSandbox(primaryProfileId!, activeReview!.id);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: primaryProfileId !== null && primaryProfileId !== undefined && Boolean(activeReview),
  });

  // Review and version identities are authoritative server-provided SHA-256
  // digests bound to the immutable review snapshot/version.
  const activeVersion = activeReview
    ? versions.find((version) => version.id === activeReview.versionId)
    : undefined;
  const reviewDigest = activeReview?.digest ?? "";
  const versionDigest = activeVersion?.digest ?? "";

  // Seed the editable, isolated sandbox inputs from the immutable snapshot and
  // any previously saved private sandbox override. The snapshot/review/version
  // are never mutated; only local component state and the private sandbox move.
  useEffect(() => {
    if (!activeReview) {
      setSandboxInputs(null);
      setLastSimulation(null);
      return;
    }
    setSandboxInputs(
      readInputsFromSandboxDocument(activeReview.snapshot, sandbox?.document),
    );
    setLastSimulation(null);
    // Re-seed whenever the review, its digest, or the saved sandbox change.
  }, [activeReview, reviewDigest, sandbox?.document]);

  const inputsDirty = useMemo(() => {
    if (!activeReview || !sandboxInputs) return false;
    const saved = readInputsFromSandboxDocument(
      activeReview.snapshot,
      sandbox?.document,
    );
    return JSON.stringify(saved) !== JSON.stringify(sandboxInputs);
  }, [activeReview, sandbox?.document, sandboxInputs]);

  const updateInput = <K extends keyof ReviewSandboxInputs>(
    key: K,
    value: ReviewSandboxInputs[K],
  ) => {
    setSandboxInputs((prev) => (prev ? { ...prev, [key]: value } : prev));
    setLastSimulation(null);
  };

  const saveSandboxMutation = useMutation({
    mutationFn: async () => {
      if (!primaryProfileId || !activeReview || !sandboxInputs) {
        throw new Error("No review selected");
      }
      // Persist ONLY the isolated sandbox copy — never the shared draft/version.
      const document = applyInputsToSandboxDocument(activeReview.snapshot, sandboxInputs);
      const res = await governanceApi.saveSandbox(primaryProfileId, activeReview.id, document);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Isolated sandbox inputs saved" });
      void qc.invalidateQueries({ queryKey: ['profile-sandbox', primaryProfileId, activeReview?.id] });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const resetSandboxMutation = useMutation({
    mutationFn: async () => {
      if (!primaryProfileId) throw new Error("No review selected");
      const res = await governanceApi.resetSandbox(primaryProfileId);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Sandbox reset to snapshot baseline" });
      void qc.invalidateQueries({ queryKey: ['profile-sandbox', primaryProfileId, activeReview?.id] });
    },
    onError: (err: Error) => toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  // Run a deterministic local evaluation of the edited inputs. Only AFTER a run
  // produces a result do we record simulation evidence against the immutable
  // version. This is a simulation only — no firmware/hardware is implemented.
  const runSimulationMutation = useMutation({
    mutationFn: async () => {
      if (!activeReview || !sandboxInputs) throw new Error("No review selected");
      const result = runSandboxSimulation(activeReview.snapshot, sandboxInputs);
      setLastSimulation(result);
      const res = await governanceApi.recordSimulation(activeReview.versionId, result.passed, {
        source: 'client-review-sandbox',
        isolated: true,
        implementation: 'simulation-only',
        note: 'Deterministic local sandbox evaluation of isolated reviewer inputs; does not implement or verify firmware or hardware.',
        reviewDigest,
        versionDigest: versionDigest || null,
        versionId: activeReview.versionId,
        reviewId: activeReview.id,
        inputs: sandboxInputs,
        result: {
          passed: result.passed,
          summary: result.summary,
          checks: result.checks,
        },
        recordedAt: new Date().toISOString(),
      }, activeReview.id);
      if (!res.ok) throw new Error(res.error);
      return result;
    },
    onSuccess: (result) =>
      toast({
        title: result.passed
          ? "Sandbox simulation PASSED — evidence recorded"
          : "Sandbox simulation FAILED — evidence recorded",
        variant: result.passed ? undefined : "destructive",
      }),
    onError: (err: Error) => toast({ title: "Simulation failed", description: err.message, variant: "destructive" }),
  });

  const addComment = useMutation({
    mutationFn: async (content: string) => {
      if (!user || !activeReviewOverview) throw new Error("Missing state");
      const res = await governanceApi.addComment(activeReviewOverview.id, content);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      setNewComment("");
      qc.invalidateQueries({ queryKey: ['review', activeReviewOverview?.id] });
    },
    onError: (err: any) => toast({ title: "Failed to add comment", description: err.message, variant: "destructive" })
  });

  const submitDecision = useMutation({
    mutationFn: async (decision: 'ACCEPTED' | 'CHANGES_REQUESTED') => {
      if (!user || !activeReviewOverview) throw new Error("Missing state");
      const res = await governanceApi.submitDecision(activeReviewOverview.id, decision, decisionNotes);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Decision submitted successfully" });
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['review', activeReviewOverview?.id] });
    },
    onError: (err: any) => toast({ title: "Decision failed", description: err.message, variant: "destructive" })
  });

  if (openReviews.length === 0 && !activeReviewOverview) {
    return (
      <div className="flex flex-col h-full gap-6 animate-in fade-in duration-300">
        <div>
           <h1 className="text-2xl font-mono text-foreground font-bold uppercase tracking-wider mb-2">Client Review</h1>
           <p className="text-xs font-mono text-muted-foreground max-w-4xl leading-relaxed">
             Review pending profile changes submitted by Firmware Engineering.
           </p>
        </div>
        <Card className="border-border border-dashed bg-transparent">
          <CardContent className="p-12 text-center text-muted-foreground font-mono text-sm flex flex-col items-center">
            <CheckSquare className="w-8 h-8 mb-4 opacity-50" />
            No profiles currently pending review.
          </CardContent>
        </Card>
      </div>
    );
  }

  const myDecision = decisions.find((d: ReviewDecision) => d.actorId === user?.userId);

  return (
    <div className="flex flex-col h-full gap-6 animate-in fade-in duration-300">
      <div>
         <h1 className="text-2xl font-mono text-foreground font-bold uppercase tracking-wider mb-2">Client Review</h1>
         <p className="text-xs font-mono text-muted-foreground max-w-4xl leading-relaxed">
           Review pending profile changes submitted by Firmware Engineering.
         </p>
      </div>

      <div className="flex gap-6 items-start">
        <div className="w-64 shrink-0 flex flex-col gap-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Pending Reviews</div>
          {openReviews.map((r: Review) => (
            <button
              key={r.id}
              onClick={() => setSelectedReviewId(r.id)}
              className={`text-left p-3 border rounded-sm font-mono transition-colors ${
                activeReviewOverview?.id === r.id 
                  ? 'border-primary bg-primary/10' 
                  : 'border-border bg-card hover:border-primary/50 hover:bg-black/20'
              }`}
            >
              <div className="text-xs font-bold text-foreground">Review #{r.id}</div>
              <div className="text-[10px] text-muted-foreground mt-1 truncate">
                {format(new Date(r.submittedAt), 'MMM d, yyyy HH:mm')}
              </div>
            </button>
          ))}
          {openReviews.length === 0 && (
             <div className="text-[10px] font-mono text-muted-foreground italic border border-dashed border-border/50 p-3 text-center">
               None pending.
             </div>
          )}
        </div>

        {activeReview && (
          <div className="flex-1 flex flex-col gap-6 min-w-0">
            <Card className="border-border bg-card/50 backdrop-blur">
              <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
                <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4" />
                    Reviewing #{activeReview.id} (Version {activeReview.versionId})
                  </div>
                  <div className="text-xs font-mono text-muted-foreground flex gap-4 items-center">
                    <span>Fields: {activeReview.snapshot.fields.length}</span>
                    <span data-testid="text-review-digest" title={versionDigest || undefined}>
                      Review digest: <span className="text-primary break-all">{reviewDigest}</span>
                      {versionDigest ? <span className="ml-1 text-muted-foreground/70">(ver {versionDigest.slice(0, 12)}…)</span> : null}
                    </span>
                    <span className={activeReview.state === 'OPEN' ? 'text-warning' : 'text-success'}>Status: {activeReview.state}</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-3 mb-6 font-mono text-[10px]">
                  <div className="border border-border p-3" data-testid="status-review-diff">
                    Classified changes
                    <div className="mt-1 text-primary">
                      {diff ? `${diff.counts?.field ?? 0} field · ${diff.counts?.mapping ?? 0} mapping · ${diff.counts?.timing ?? 0} timing · ${diff.counts?.behavior ?? 0} behavior` : "Baseline unavailable"}
                    </div>
                  </div>
                  <div className="border border-border p-3" data-testid="status-client-sandbox">
                    Private sandbox
                    <div className="mt-1 text-primary">{sandbox ? "ISOLATED OVERRIDES ACTIVE" : "CLEAN"}{inputsDirty ? " · UNSAVED EDITS" : ""}</div>
                  </div>
                </div>

                <div className="border border-border/60 bg-black/20 p-4 mb-6 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <FlaskConical className="w-3 h-3" /> Isolated Sandbox Inputs
                    </div>
                    <div className="text-[9px] font-mono text-muted-foreground/70">
                      Simulation only — does not implement or verify firmware/hardware.
                    </div>
                  </div>

                  {sandboxInputs && (
                    <>
                      <div className="grid grid-cols-3 gap-3 font-mono text-[10px]">
                        <label className="flex flex-col gap-1">
                          <span className="text-muted-foreground">Requested Packet Interval (ms)</span>
                          <input
                            type="number"
                            value={sandboxInputs.requestedPacketIntervalMs}
                            onChange={(e) => updateInput('requestedPacketIntervalMs', Number(e.target.value))}
                            className="bg-black/40 border border-border text-foreground p-2 focus:outline-none focus:border-primary/50"
                            data-testid="input-sandbox-rpi"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-muted-foreground">Explicit Message Timeout (ms)</span>
                          <input
                            type="number"
                            value={sandboxInputs.timeoutMs}
                            onChange={(e) => updateInput('timeoutMs', Number(e.target.value))}
                            className="bg-black/40 border border-border text-foreground p-2 focus:outline-none focus:border-primary/50"
                            data-testid="input-sandbox-timeout"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-muted-foreground">Runtime Tolerance (ms)</span>
                          <input
                            type="number"
                            value={sandboxInputs.toleranceMs}
                            onChange={(e) => updateInput('toleranceMs', Number(e.target.value))}
                            className="bg-black/40 border border-border text-foreground p-2 focus:outline-none focus:border-primary/50"
                            data-testid="input-sandbox-tolerance"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3 font-mono text-[10px]">
                        <label className="flex flex-col gap-1">
                          <span className="text-muted-foreground">Representative Command / Field</span>
                          <select
                            value={sandboxInputs.representativeField}
                            onChange={(e) => updateInput('representativeField', e.target.value)}
                            className="bg-black/40 border border-border text-foreground p-2 focus:outline-none focus:border-primary/50"
                            data-testid="select-sandbox-field"
                          >
                            {activeReview.snapshot.fields.map((f) => (
                              <option key={f.symbolicName} value={f.symbolicName}>
                                {f.symbolicName} ({f.direction})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-muted-foreground">Expected Reported Response (verification override — blank uses snapshot)</span>
                          <input
                            type="text"
                            value={sandboxInputs.expectedResponseOverride}
                            onChange={(e) => updateInput('expectedResponseOverride', e.target.value)}
                            placeholder="Leave blank to use snapshot value"
                            className="bg-black/40 border border-border text-foreground p-2 focus:outline-none focus:border-primary/50"
                            data-testid="input-sandbox-expected-response"
                          />
                        </label>
                      </div>

                      <div className="flex gap-2 items-center justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resetSandboxMutation.mutate()}
                          disabled={(!sandbox && !inputsDirty) || resetSandboxMutation.isPending}
                          data-testid="button-reset-client-sandbox"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" /> RESET
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => saveSandboxMutation.mutate()}
                          disabled={!inputsDirty || saveSandboxMutation.isPending}
                          data-testid="button-save-client-sandbox"
                        >
                          <Save className="w-3 h-3 mr-1" /> SAVE SANDBOX
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => runSimulationMutation.mutate()}
                          disabled={runSimulationMutation.isPending}
                          data-testid="button-run-review-simulation"
                        >
                          <FlaskConical className="w-3 h-3 mr-1" /> RUN SIMULATION
                        </Button>
                      </div>
                    </>
                  )}

                  {lastSimulation && (
                    <div
                      className={`border p-3 font-mono text-[10px] flex flex-col gap-2 ${
                        lastSimulation.passed
                          ? 'border-success/40 bg-success/10'
                          : 'border-destructive/40 bg-destructive/10'
                      }`}
                      data-testid="result-review-simulation"
                    >
                      <div className={`font-bold flex items-center gap-2 ${lastSimulation.passed ? 'text-success' : 'text-destructive'}`}>
                        {lastSimulation.passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        <span data-testid="text-simulation-verdict">{lastSimulation.passed ? 'PASS' : 'FAIL'}</span>
                        <span className="text-foreground/70 font-normal">{lastSimulation.summary}</span>
                      </div>
                      <ul className="flex flex-col gap-1">
                        {lastSimulation.checks.map((check) => (
                          <li key={check.id} className="flex items-start gap-2" data-testid={`result-check-${check.id}`}>
                            {check.passed
                              ? <CheckCircle2 className="w-3 h-3 mt-0.5 text-success shrink-0" />
                              : <XCircle className="w-3 h-3 mt-0.5 text-destructive shrink-0" />}
                            <span>
                              <span className="text-foreground">{check.label}</span>
                              <span className="text-muted-foreground"> — {check.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="text-[9px] text-muted-foreground/70">
                        Recorded against immutable version {activeReview.versionId} · source client-review-sandbox · isolated · simulation-only.
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-6">
                  <div className="flex flex-col gap-4">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-2 flex items-center gap-2">
                      <MessageSquare className="w-3 h-3" /> Comments
                    </div>
                    <div className="flex flex-col gap-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                      {comments.length === 0 && (
                        <div className="text-[10px] text-muted-foreground italic font-mono">No comments yet.</div>
                      )}
                      {comments.map((c: ReviewComment) => (
                        <div key={c.id} className="p-3 border rounded-sm bg-black/40 border-border">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-[10px] font-mono font-bold text-foreground">{c.authorUsername} <span className="text-muted-foreground font-normal ml-1">({c.authorRole})</span></span>
                            <span className="text-[9px] font-mono text-muted-foreground">{format(new Date(c.createdAt), 'MMM d, HH:mm')}</span>
                          </div>
                          <div className="text-xs font-mono text-foreground/80 mb-2">{c.body}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-border/50">
                      <textarea
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        placeholder="Add a comment..."
                        className="w-full bg-black/40 border border-border text-foreground font-mono text-xs p-2 h-20 resize-none focus:outline-none focus:border-primary/50"
                         data-testid="input-review-comment"
                      />
                      <Button 
                        size="sm" 
                        disabled={!newComment.trim() || addComment.isPending}
                        onClick={() => addComment.mutate(newComment)}
                        className="self-end h-7 text-[10px] font-mono"
                      >
                        POST COMMENT
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-2 flex items-center gap-2">
                      <CheckSquare className="w-3 h-3" /> Decision
                    </div>
                    {myDecision ? (
                      <div className={`p-4 border rounded-sm font-mono text-xs ${
                        myDecision.decision === 'ACCEPTED' ? 'bg-success/10 border-success/30 text-success' : 'bg-destructive/10 border-destructive/30 text-destructive'
                      }`}>
                        <div className="font-bold mb-2 flex items-center gap-2">
                          {myDecision.decision === 'ACCEPTED' ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                          YOU {myDecision.decision === 'ACCEPTED' ? 'ACCEPTED' : 'REQUESTED CHANGES ON'} THIS DRAFT
                        </div>
                        <div className="text-foreground/80">{myDecision.rationale || 'No rationale provided.'}</div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <textarea
                          value={decisionNotes}
                          onChange={e => setDecisionNotes(e.target.value)}
                          placeholder="Final review rationale (required for rejection, optional for approval)..."
                          className="w-full bg-black/40 border border-border text-foreground font-mono text-xs p-2 h-32 resize-none focus:outline-none focus:border-primary/50"
                           data-testid="input-review-rationale"
                        />
                        <div className="flex gap-2 justify-end">
                          <Button 
                            variant="outline"
                            className="h-8 text-[10px] font-mono border-destructive text-destructive hover:bg-destructive/10"
                            disabled={!decisionNotes.trim() || submitDecision.isPending}
                            onClick={() => submitDecision.mutate('CHANGES_REQUESTED')}
                          >
                            REQUEST CHANGES
                          </Button>
                          <Button 
                            className="h-8 text-[10px] font-mono border border-success/60 bg-success/10 text-success hover:bg-success/20"
                            disabled={submitDecision.isPending}
                            onClick={() => submitDecision.mutate('ACCEPTED')}
                          >
                            APPROVE FOR PUBLICATION
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
