import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw } from "lucide-react";
import { activityApi, type ActivityLogItem } from "@/lib/activity-api";
import { adminApi } from "@/lib/auth-api";

function SafeDetailView({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail || Object.keys(detail).length === 0) return null;

  // Safe compact renderer that only shows primitive/short allowlisted values
  const safeEntries: string[] = [];
  for (const [k, v] of Object.entries(detail)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.length < 100) {
      safeEntries.push(`${k}=${v}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      safeEntries.push(`${k}=${v}`);
    }
    // Silently ignore nested objects, arrays, or long strings to prevent arbitrary payload rendering
  }

  if (safeEntries.length === 0) return null;

  return (
    <div className="mt-1 text-muted-foreground text-[9px] break-all">
      {safeEntries.join(' · ')}
    </div>
  );
}

export function AdminActivityLogCard() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [category, setCategory] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [targetType, setTargetType] = useState<string>("");
  const [targetId, setTargetId] = useState<string>("");
  const [actorId, setActorId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const { data: users = [] } = useQuery({
    queryKey: ["admin-users-list"],
    queryFn: async () => {
      const result = await adminApi.listUsers();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-activity", page, pageSize, category, action, outcome, targetType, targetId, actorId, from, to],
    queryFn: async () => {
      const res = await activityApi.listActivity({
        page,
        pageSize,
        category,
        action,
        outcome,
        targetType,
        targetId,
        actorId: actorId ? Number(actorId) : undefined,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });

  const resetFiltersAndPage = (updateFn: () => void) => {
    updateFn();
    setPage(1);
  };

  return (
    <Card className="max-w-4xl border-border bg-card/50 backdrop-blur" data-testid="card-admin-activity">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="flex items-center gap-2 text-sm font-mono tracking-widest text-primary">
          <Activity className="h-4 w-4" />
          Administrator Activity Log
        </CardTitle>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 font-mono text-[10px]"
            onClick={() => void refetch()}
            disabled={isFetching}
            data-testid="button-refresh-activity"
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} /> REFRESH
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="font-mono text-[10px] text-muted-foreground">
          Note: Retention is {data?.retentionPolicy ?? 'append-only and indefinite'}. Passwords and sensitive raw data are strictly excluded.
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[10px]">
          <select
            value={category}
            onChange={(e) => resetFiltersAndPage(() => setCategory(e.target.value))}
            className="border border-border bg-black/40 px-2 py-1.5 text-foreground focus:outline-none"
            data-testid="filter-category"
          >
            <option value="">All Categories</option>
            <option value="AUTH">Auth</option>
            <option value="USER_MANAGEMENT">User Management</option>
            <option value="SECURITY">Security</option>
            <option value="PROFILE_GOVERNANCE">Profile Governance</option>
            <option value="CLIENT_EVENT">Client Event</option>
            <option value="DOWNLOAD">Download</option>
          </select>
          <input
            type="text"
            placeholder="Action (e.g. LOGIN)"
            value={action}
            onChange={(e) => resetFiltersAndPage(() => setAction(e.target.value))}
            className="border border-border bg-black/40 px-2 py-1.5 text-foreground focus:outline-none"
            data-testid="filter-action"
          />
          <select
            value={outcome}
            onChange={(e) => resetFiltersAndPage(() => setOutcome(e.target.value))}
            className="border border-border bg-black/40 px-2 py-1.5 text-foreground focus:outline-none"
            data-testid="filter-outcome"
          >
            <option value="">All Outcomes</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
            <option value="DENIED">Denied</option>
          </select>
          <input
            type="text"
            placeholder="Target Type"
            value={targetType}
            onChange={(e) => resetFiltersAndPage(() => setTargetType(e.target.value))}
            className="border border-border bg-black/40 px-2 py-1.5 text-foreground focus:outline-none"
            data-testid="filter-target-type"
          />
          <input
            type="text"
            placeholder="Target ID"
            value={targetId}
            onChange={(e) => resetFiltersAndPage(() => setTargetId(e.target.value))}
            className="border border-border bg-black/40 px-2 py-1.5 text-foreground focus:outline-none"
            data-testid="filter-target-id"
          />
          <select
            value={actorId}
            onChange={(e) => resetFiltersAndPage(() => setActorId(e.target.value))}
            className="border border-border bg-black/40 px-2 py-1.5 text-foreground focus:outline-none"
            data-testid="filter-actor"
          >
            <option value="">All Actors</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => resetFiltersAndPage(() => setFrom(e.target.value))}
            className="border border-border bg-black/40 px-2 py-1.5 text-foreground focus:outline-none"
            data-testid="filter-from"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => resetFiltersAndPage(() => setTo(e.target.value))}
            className="border border-border bg-black/40 px-2 py-1.5 text-foreground focus:outline-none"
            data-testid="filter-to"
          />
        </div>

        {isLoading ? (
          <div className="font-mono text-xs text-muted-foreground animate-pulse">Loading activity history...</div>
        ) : isError ? (
          <div className="font-mono text-xs text-destructive">Failed to load: {(error as Error).message}</div>
        ) : (
          <>
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {data?.items.map((entry: ActivityLogItem) => (
                <div key={entry.id} className="grid grid-cols-[130px_minmax(100px,auto)_1fr_auto] gap-3 border border-border/50 bg-black/20 p-3 font-mono text-[10px]" data-testid={`row-activity-${entry.id}`}>
                  <div className="text-muted-foreground">{format(new Date(entry.createdAt), "yyyy-MM-dd HH:mm:ss")}</div>
                  <div className="text-left">
                    <div className="text-primary">{entry.actorUsername ?? 'SYSTEM'}</div>
                    {entry.actorRole && <div className="text-muted-foreground text-[9px]">{entry.actorRole}</div>}
                  </div>
                  <div>
                    <div className="font-bold text-foreground">
                      {entry.category} / {entry.action}
                      {entry.outcome !== 'SUCCESS' && (
                        <span className="ml-2 text-warning">{entry.outcome}</span>
                      )}
                    </div>
                    {entry.targetLabel && <div className="mt-1 text-foreground font-semibold">{entry.targetLabel}</div>}
                    <SafeDetailView detail={entry.detail} />
                  </div>
                </div>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <div className="font-mono text-xs text-muted-foreground">No activity events found.</div>
              )}
            </div>

            {data && data.total > pageSize && (
              <div className="flex justify-between items-center mt-4 pt-2 border-t border-border/50 font-mono text-[10px]">
                <div className="text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, data.total)} of {data.total}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[9px]"
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    PREV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[9px]"
                    disabled={page * pageSize >= data.total}
                    onClick={() => setPage(p => p + 1)}
                  >
                    NEXT
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
