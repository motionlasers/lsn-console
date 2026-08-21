import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { governanceApi, Review, ReviewComment, ReviewDecision } from "@/lib/profile-governance-api";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckSquare, MessageSquare, ShieldAlert, CheckCircle2, GitBranch, FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function ProfileReview() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [newComment, setNewComment] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");

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
    queryKey: ['profile-sandbox', primaryProfileId],
    queryFn: async () => {
      const res = await governanceApi.getSandbox(primaryProfileId!);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: primaryProfileId !== null && primaryProfileId !== undefined,
  });

  const sandboxMutation = useMutation({
    mutationFn: async (action: 'initialize' | 'reset') => {
      if (!primaryProfileId || !activeReview) throw new Error("No review selected");
      const res = action === 'reset'
        ? await governanceApi.resetSandbox(primaryProfileId)
        : await governanceApi.saveSandbox(primaryProfileId, activeReview.snapshot);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['profile-sandbox', primaryProfileId] }),
  });

  const simulationMutation = useMutation({
    mutationFn: async () => {
      if (!activeReview) throw new Error("No review selected");
      const res = await governanceApi.recordSimulation(activeReview.versionId, true, {
        source: 'client-review-sandbox',
        isolated: true,
        recordedAt: new Date().toISOString(),
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => toast({ title: "Simulation evidence recorded for this immutable version" }),
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
                  <div className="text-xs font-mono text-muted-foreground flex gap-4">
                    <span>Fields: {activeReview.snapshot.fields.length}</span>
                    <span className={activeReview.state === 'OPEN' ? 'text-warning' : 'text-success'}>Status: {activeReview.state}</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-3 gap-3 mb-6 font-mono text-[10px]">
                  <div className="border border-border p-3" data-testid="status-review-diff">
                    Classified changes
                    <div className="mt-1 text-primary">
                      {diff ? `${diff.counts?.field ?? 0} field · ${diff.counts?.mapping ?? 0} mapping · ${diff.counts?.timing ?? 0} timing · ${diff.counts?.behavior ?? 0} behavior` : "Baseline unavailable"}
                    </div>
                  </div>
                  <div className="border border-border p-3" data-testid="status-client-sandbox">
                    Private sandbox
                    <div className="mt-1 text-primary">{sandbox ? "ISOLATED OVERRIDES ACTIVE" : "CLEAN"}</div>
                  </div>
                  <div className="border border-border p-3 flex gap-2 items-center justify-end">
                    <Button size="sm" variant="outline" onClick={() => sandboxMutation.mutate(sandbox ? 'reset' : 'initialize')} data-testid="button-reset-client-sandbox">
                      <RotateCcw className="w-3 h-3 mr-1" /> {sandbox ? "RESET" : "START SANDBOX"}
                    </Button>
                    <Button size="sm" onClick={() => simulationMutation.mutate()} data-testid="button-run-review-simulation">
                      <FlaskConical className="w-3 h-3 mr-1" /> SIMULATE
                    </Button>
                  </div>
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
