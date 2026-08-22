import {
  isProfileItemSupported,
  isTestSupported,
  isTransactionSupported,
  getTelemetryFreshness,
  useStore,
  visibleLogicalState,
} from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, RefreshCw, Download, Upload, Play, KeyRound, Users, Trash2, ShieldCheck, Plus, Eye, EyeOff, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/exports";
import { useRef, useState, type FormEvent } from "react";
import { useTourStore } from "@/hooks/use-tour";
import { useAuth } from "@/contexts/AuthContext";
import { authApi, adminApi, type AdminUser, type CanonicalRole } from "@/lib/auth-api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { governanceApi } from "@/lib/profile-governance-api";
import { activityApi, generateEventId } from "@/lib/activity-api";
import { format } from "date-fns";

// ─── Change Password Card ─────────────────────────────────────────────────────
function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const result = await authApi.changePassword(currentPassword, newPassword);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
  };

  return (
    <Card className="max-w-2xl border-border bg-card/50 backdrop-blur" data-testid="card-user-management">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <KeyRound className="w-4 h-4" />
          Change Password
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] font-mono text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div role="status" className="border border-success/30 bg-success/10 px-3 py-2 text-[11px] font-mono text-success">
              Password changed successfully.
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest">
              Current Password
            </label>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-black/40 border border-border text-foreground font-mono text-sm px-3 py-2 pr-10 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showCurrent ? "Hide password" : "Show password"}
              >
                {showCurrent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full bg-black/40 border border-border text-foreground font-mono text-sm px-3 py-2 pr-10 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">Minimum 8 characters</div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-mono text-muted-foreground uppercase tracking-widest">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full bg-black/40 border border-border text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={submitting}
              className="font-mono text-xs tracking-widest"
            >
              {submitting ? "UPDATING…" : "UPDATE PASSWORD"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Admin user management card ───────────────────────────────────────────────
function AdminUsersCard() {
  const { user: selfUser } = useAuth();
  const qc = useQueryClient();
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<CanonicalRole>("CLIENT_REVIEWER");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const result = await adminApi.listUsers();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  });

  const toggleCanonicalRoleMutation = useMutation({
    mutationFn: async (args: { userId: number; role: CanonicalRole }) => {
      const res = await adminApi.updateUser(args.userId, { role: args.role });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] })
  });

  const createMutation = useMutation({
    mutationFn: (args: { username: string; password: string; role: CanonicalRole }) =>
      adminApi.createUser(args.username, args.password, args.role),
    onSuccess: (result) => {
      if (!result.ok) { setCreateError(result.error); return; }
      setCreateError(null);
      setNewUsername("");
      setNewPassword("");
      setNewRole("CLIENT_REVIEWER");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => setCreateError(String(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminApi.deleteUser(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const editPasswordMutation = useMutation({
    mutationFn: (args: { id: number; password: string }) =>
      adminApi.updateUser(args.id, { password: args.password }),
    onSuccess: (result) => {
      if (!result.ok) { setEditError(result.error); return; }
      setEditingId(null);
      setEditPassword("");
      setEditError(null);
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => setEditError(String(err)),
  });

  const toggleAdminMutation = useMutation({
    mutationFn: (args: { id: number; isAdmin: boolean }) =>
      adminApi.updateUser(args.id, { isAdmin: args.isAdmin }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (newUsername.trim().length < 2) { setCreateError("Username must be at least 2 characters."); return; }
    if (newPassword.length < 8) { setCreateError("Password must be at least 8 characters."); return; }
    createMutation.mutate({ username: newUsername.trim(), password: newPassword, role: newRole });
  };

  const handleEditPassword = (e: FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setEditError(null);
    if (editPassword.length < 8) { setEditError("Password must be at least 8 characters."); return; }
    editPasswordMutation.mutate({ id: editingId, password: editPassword });
  };

  return (
    <Card className="max-w-2xl border-border bg-card/50 backdrop-blur">
      <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
          <Users className="w-4 h-4" />
          User Management
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">

        {/* User list */}
        <div className="space-y-2">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">Accounts</div>
          {isLoading && (
            <div className="text-[11px] font-mono text-muted-foreground animate-pulse">Loading…</div>
          )}
          {users.map((u: AdminUser) => (
            <div key={u.id} className="border border-border/50 bg-background/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-mono text-foreground truncate">{u.username}</span>
                  <span className="text-[9px] font-mono text-primary border border-primary/30 px-1.5 py-0.5 uppercase tracking-widest">
                    {u.role.replaceAll("_", " ")}
                  </span>
                  {u.forcePasswordChange && (
                    <span className="text-[9px] font-mono text-warning border border-warning/30 px-1.5 py-0.5 uppercase tracking-widest">
                      PWD RESET
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Canonical Roles Toggles */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`font-mono text-[9px] h-7 px-2 border ${
                      u.role === 'FIRMWARE_ADMIN'
                        ? 'border-primary text-primary' 
                        : 'border-border/50 text-muted-foreground hover:text-primary'
                    }`}
                    onClick={() => toggleCanonicalRoleMutation.mutate({ userId: u.id, role: 'FIRMWARE_ADMIN' })}
                    title="Set Firmware Admin Role"
                  >
                    FW ADMIN
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`font-mono text-[9px] h-7 px-2 border mr-2 ${
                      u.role === 'CLIENT_REVIEWER'
                        ? 'border-primary text-primary' 
                        : 'border-border/50 text-muted-foreground hover:text-primary'
                    }`}
                    onClick={() => toggleCanonicalRoleMutation.mutate({ userId: u.id, role: 'CLIENT_REVIEWER' })}
                    title="Set Client Reviewer Role"
                  >
                    REVIEWER
                  </Button>

                  {/* Superadmin assignment (not self) */}
                  {u.id !== selfUser?.userId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`font-mono text-[10px] h-7 px-2 ${u.isAdmin ? 'text-amber-500 hover:text-muted-foreground' : 'text-muted-foreground hover:text-amber-500'}`}
                      onClick={() => toggleAdminMutation.mutate({ id: u.id, isAdmin: !u.isAdmin })}
                      title={u.isAdmin ? "Move to Client Reviewer" : "Set Superadmin"}
                    >
                      <ShieldCheck className="w-3 h-3" />
                    </Button>
                  )}
                  {/* Edit password */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="font-mono text-[10px] h-7 px-2 text-muted-foreground hover:text-primary"
                    onClick={() => {
                      setEditingId(editingId === u.id ? null : u.id);
                      setEditPassword("");
                      setEditError(null);
                    }}
                    title="Reset password"
                  >
                    <KeyRound className="w-3 h-3" />
                  </Button>
                  {/* Delete (not self) */}
                  {u.id !== selfUser?.userId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="font-mono text-[10px] h-7 px-2 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(u.id)}
                      title="Delete user"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Inline password edit */}
              {editingId === u.id && (
                <form onSubmit={handleEditPassword} className="flex gap-2 pt-1">
                  {editError && (
                    <div className="text-[10px] font-mono text-destructive mb-1">{editError}</div>
                  )}
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="New password (min 8)"
                    minLength={8}
                    required
                    autoFocus
                    className="flex-1 bg-black/40 border border-border text-foreground font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                  />
                  <Button type="submit" size="sm" className="font-mono text-[10px] h-7">SET</Button>
                  <Button type="button" variant="ghost" size="sm" className="font-mono text-[10px] h-7" onClick={() => { setEditingId(null); setEditError(null); }}>
                    CANCEL
                  </Button>
                </form>
              )}
            </div>
          ))}
        </div>

        {/* Create user form */}
        <div className="border-t border-border/50 pt-6">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">Add User</div>
          <form onSubmit={handleCreate} className="space-y-3">
            {createError && (
              <div role="alert" className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] font-mono text-destructive">
                {createError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="username"
                  className="w-full bg-black/40 border border-border text-foreground font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
                  Initial Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="min 8 chars"
                  className="w-full bg-black/40 border border-border text-foreground font-mono text-xs px-3 py-2 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Role</span>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as CanonicalRole)}
                  className="bg-black/40 border border-border text-foreground font-mono text-xs px-2 py-1.5"
                  data-testid="select-new-user-role"
                >
                  <option value="CLIENT_REVIEWER">Client Reviewer</option>
                  <option value="FIRMWARE_ADMIN">Firmware Admin</option>
                  <option value="SUPERADMIN">Superadmin</option>
                </select>
              </label>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="font-mono text-xs h-8"
              >
                <Plus className="w-3 h-3 mr-1" />
                {createMutation.isPending ? "CREATING…" : "CREATE USER"}
              </Button>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              New users will be prompted to change their password on first login.
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminAuditCard() {
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const { data: profiles = [] } = useQuery({
    queryKey: ["governance-profiles"],
    queryFn: async () => {
      const result = await governanceApi.listProfiles();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  });
  const profileId = selectedProfileId ?? profiles[0]?.id;
  const { data: audit = [], isLoading, refetch } = useQuery({
    queryKey: ["profile-audit", profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await governanceApi.listAudit(profileId);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    enabled: Boolean(profileId),
  });

  return (
    <Card className="max-w-4xl border-border bg-card/50 backdrop-blur" data-testid="card-governance-audit">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 bg-black/20 pb-4">
        <CardTitle className="flex items-center gap-2 text-sm font-mono tracking-widest text-primary">
          <ScrollText className="h-4 w-4" />
          Governance Audit History
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="h-7 font-mono text-[10px]"
          onClick={() => void refetch()}
          data-testid="button-refresh-governance-audit"
        >
          <RefreshCw className="mr-1 h-3 w-3" /> REFRESH
        </Button>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="mb-3 font-mono text-[10px] text-muted-foreground">
          Append-only profile lifecycle events with the responsible account and canonical role.
        </div>
        {profiles.length > 0 && (
          <label className="mb-3 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            PROFILE
            <select
              value={profileId ?? ""}
              onChange={(event) => setSelectedProfileId(Number(event.target.value))}
              className="border border-border bg-black/40 px-2 py-1 text-foreground"
              data-testid="select-governance-audit-profile"
            >
              {profiles.map(profile => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>
        )}
        {isLoading ? (
          <div className="font-mono text-xs text-muted-foreground">Loading audit history…</div>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {audit.map((entry) => (
              <div key={entry.id} className="grid grid-cols-[minmax(130px,auto)_1fr_auto] gap-3 border border-border/50 bg-black/20 p-3 font-mono text-[10px]" data-testid={`row-audit-${entry.id}`}>
                <div className="text-muted-foreground">{format(new Date(entry.createdAt), "yyyy-MM-dd HH:mm:ss")}</div>
                <div>
                  <div className="font-bold text-foreground">{entry.action}</div>
                  <div className="mt-1 break-all text-muted-foreground">
                    {entry.versionId ? `Version ID ${entry.versionId} · ` : ""}
                    {JSON.stringify(entry.detail ?? {})}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-primary">{entry.actorUsername}</div>
                  <div className="text-muted-foreground">{entry.actorRole}</div>
                </div>
              </div>
            ))}
            {!profileId && <div className="font-mono text-xs text-muted-foreground">No governed profile exists.</div>}
            {profileId && audit.length === 0 && <div className="font-mono text-xs text-muted-foreground">No audit events recorded.</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { AdminActivityLogCard } from "@/components/AdminActivityLog";

// ─── Main settings page ───────────────────────────────────────────────────────
export default function SettingsPage() {
  const { settings, logicalState, updateSettings, updateLogicalState, resetSettings, importState } = useStore();
  const { startTour } = useTourStore();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedBrandLogo = settings.brandLogo ?? 'sia';

  const handleUpdateSetting = (key: keyof typeof settings, value: any) => {
    const oldValue = settings[key];
    if (oldValue !== value) {
      updateSettings({ [key]: value });
      activityApi.recordEvent({
        eventName: 'SETTING_CHANGED',
        clientEventId: generateEventId(),
        targetType: 'SETTING',
        targetId: key,
        targetLabel: key,
        detail: { before: oldValue, after: value, scope: 'settings' }
      });
    }
  };

  const handleUpdateLogicalState = (key: keyof typeof logicalState, value: any) => {
    const oldValue = logicalState[key];
    if (oldValue !== value) {
      updateLogicalState({ [key]: value });
      activityApi.recordEvent({
        eventName: 'SETTING_CHANGED',
        clientEventId: generateEventId(),
        targetType: 'LOGICAL_STATE',
        targetId: key,
        targetLabel: key,
        detail: { before: oldValue, after: value, scope: 'logical_state' }
      });
    }
  };

  const handleExportState = () => {
    const state = useStore.getState();
    const snapshot = {
      version: '0.1',
      timestamp: Date.now(),
      device: state.device,
      telemetry: getTelemetryFreshness(state.connectionState, state.lastValidTelemetryAt),
      logicalStateSemantics: 'LAST_REPORTED_WHEN_TELEMETRY_IS_NOT_LIVE',
      validationScope: 'SIMULATION_TEST_HARNESS',
      firmwareImplementationInferred: false,
      logicalState: visibleLogicalState(state.logicalState, state.capabilities),
      profile: state.profile.filter(item => isProfileItemSupported(item, state.capabilities)),
      transactions: state.transactions.filter(transaction => isTransactionSupported(transaction, state.capabilities)),
      tests: state.tests.filter(test => isTestSupported(test, state.capabilities)),
      settings: state.settings,
      enabledCapabilities: Object.fromEntries(
        Object.entries(state.capabilities).filter(([, enabled]) => enabled),
      ),
    };
    downloadFile(JSON.stringify(snapshot, null, 2), `lsn-state-export.json`, 'application/json');
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        importState(e.target.result as string);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      <Card data-tour="settings-overview" className="max-w-2xl border-border bg-card/50 backdrop-blur">
        <CardHeader className="border-b border-border/50 bg-black/20 pb-4">
          <CardTitle className="text-sm font-mono tracking-widest text-primary flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Console Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          
          <div data-tour="settings-preferences" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-mono text-foreground">Navigation Brand</div>
                <div className="text-xs font-mono text-muted-foreground">Choose the logo shown at the top of the navigation bar</div>
              </div>
              <div className="flex rounded-sm border border-border p-1" role="group" aria-label="Navigation brand">
                {([
                  ['sia', 'SIA'],
                  ['bls', 'BLS'],
                ] as const).map(([value, label]) => (
                  <Button
                    key={value}
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 font-mono text-xs ${
                      selectedBrandLogo === value
                        ? 'bg-primary/20 text-primary hover:bg-primary/20 hover:text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => handleUpdateSetting('brandLogo', value)}
                    aria-pressed={selectedBrandLogo === value}
                    data-testid={`button-brand-${value}`}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/50 pt-4">
              <div>
                <div className="text-sm font-mono text-foreground">Developer Mode</div>
                <div className="text-xs font-mono text-muted-foreground">Expose raw diagnostic tools and edit profile spec</div>
              </div>
              <Button 
                variant="outline" 
                className={`font-mono text-xs border ${settings.devMode ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                onClick={() => handleUpdateSetting('devMode', !settings.devMode)}
              >
                {settings.devMode ? 'ENABLED' : 'DISABLED'}
              </Button>
            </div>

            <div className="flex items-center justify-between border-t border-border/50 pt-4">
              <div>
                <div className="text-sm font-mono text-foreground">Local Persistence</div>
                <div className="text-xs font-mono text-muted-foreground">Save console state and logs to browser storage</div>
              </div>
              <Button 
                variant="outline" 
                className={`font-mono text-xs border ${settings.localPersistence ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                onClick={() => handleUpdateSetting('localPersistence', !settings.localPersistence)}
              >
                {settings.localPersistence ? 'ENABLED' : 'DISABLED'}
              </Button>
            </div>

            <div data-tour="settings-tour" className="flex items-center justify-between border-t border-border/50 pt-4">
              <div>
                <div className="text-sm font-mono text-foreground">First-Launch Tour</div>
                <div className="text-xs font-mono text-muted-foreground">Replay the guided console overview</div>
              </div>
              <Button 
                variant="outline" 
                className="font-mono text-xs border-border text-foreground hover:text-primary hover:border-primary/50"
                onClick={() => startTour()}
                data-testid="button-settings-replay-tour"
              >
                <Play className="w-3 h-3 mr-2" /> REPLAY TOUR
              </Button>
            </div>
            
            <div className="flex flex-col gap-2 border-t border-border/50 pt-4">
              <div className="text-sm font-mono text-foreground">Simulation Timing Profile</div>
              <div className="text-xs font-mono text-muted-foreground mb-2">Adjust artificial latency for simulation responses</div>
              <div className="flex gap-2">
                {[10, 50, 100, 500].map(val => (
                   <Button 
                     key={val}
                     variant="outline"
                     className={`flex-1 font-mono text-xs ${settings.simulatorTiming === val ? 'bg-primary/20 border-primary text-primary' : 'border-border text-muted-foreground'}`}
                     onClick={() => handleUpdateSetting('simulatorTiming', val)}
                   >
                     {val}ms
                   </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border/50 pt-4">
              <div className="text-sm font-mono text-foreground">Simulation Fault Controls</div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className={`font-mono text-xs ${logicalState.commsLoss ? 'border-destructive text-destructive' : 'border-border'}`} onClick={() => handleUpdateLogicalState('commsLoss', !logicalState.commsLoss)}>
                  COMMUNICATION {logicalState.commsLoss ? 'LOST' : 'NORMAL'}
                </Button>
                <Button variant="outline" className={`font-mono text-xs ${logicalState.storageFailure ? 'border-destructive text-destructive' : 'border-border'}`} onClick={() => handleUpdateLogicalState('storageFailure', !logicalState.storageFailure)}>
                  STORAGE {logicalState.storageFailure ? 'FAILED' : 'NORMAL'}
                </Button>
              </div>
              <div className="text-xs font-mono text-muted-foreground">Dropped response simulation</div>
              <div className="grid grid-cols-3 gap-2">
                {[0, 25, 100].map(rate => (
                  <Button key={rate} variant="outline" className={`font-mono text-xs ${settings.droppedResponseRate === rate ? 'border-primary text-primary' : 'border-border'}`} onClick={() => handleUpdateSetting('droppedResponseRate', rate)}>
                    {rate}%
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-border/50 flex justify-between">
            <div className="flex gap-2">
               <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileChange} />
               <Button variant="outline" className="font-mono text-xs text-muted-foreground border-border hover:bg-white/10" onClick={handleImportClick}>
                 <Upload className="w-3 h-3 mr-2" /> IMPORT STATE
               </Button>
               <Button variant="outline" className="font-mono text-xs text-muted-foreground border-border hover:bg-white/10" onClick={handleExportState}>
                 <Download className="w-3 h-3 mr-2" /> EXPORT STATE
               </Button>
            </div>
            <Button variant="outline" className="font-mono text-xs text-destructive border-destructive/50 hover:bg-destructive hover:text-white" onClick={resetSettings}>
              <RefreshCw className="w-3 h-3 mr-2" /> RESET DEFAULTS
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change Password — visible to all authenticated users */}
      <ChangePasswordCard />

      {/* User Management — admin only */}
      {user?.isAdmin && (
        <>
          <AdminUsersCard />
          <AdminAuditCard />
          <AdminActivityLogCard />
        </>
      )}
    </div>
  );
}
