import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authApi } from "@/lib/auth-api";
import saberLogo from "@assets/Saber-Industrial-Applications-Logo_1786661980178.png";
import lsnLogo from "@assets/LSN-Industrial-transparent_1786661922957.png";

// ─── Forced-password-change dialog (exported for use by AuthShell) ───────────
export function ForcePasswordChangeDialog() {
  const { clearForcePasswordChange } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
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
    clearForcePasswordChange();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4">
        <div className="border border-amber-500/30 bg-[hsl(240,6%,7%)] shadow-2xl">
          <div className="border-b border-amber-500/20 bg-black/30 px-6 py-4">
            <div className="text-xs font-mono tracking-widest text-amber-500 uppercase">
              Password Change Required
            </div>
            <div className="mt-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Set a new password before continuing
            </div>
          </div>
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {error && (
              <div role="alert" className="border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-mono text-red-400">
                {error}
              </div>
            )}
            <div>
              <label className="block text-[10px] font-mono tracking-widest text-zinc-500 uppercase mb-1.5">
                Current Password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-black/40 border border-zinc-700 text-zinc-100 font-mono text-sm px-3 py-2 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono tracking-widest text-zinc-500 uppercase mb-1.5">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full bg-black/40 border border-zinc-700 text-zinc-100 font-mono text-sm px-3 py-2 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono tracking-widest text-zinc-500 uppercase mb-1.5">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full bg-black/40 border border-zinc-700 text-zinc-100 font-mono text-sm px-3 py-2 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-amber-500 text-black font-mono text-xs tracking-widest uppercase py-2.5 hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold"
            >
              {submitting ? "UPDATING…" : "SET NEW PASSWORD"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Login form ───────────────────────────────────────────────────────────────
function LoginForm() {
  const { login, forcePasswordChange } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await login(username.trim(), password);
    setSubmitting(false);
    if (!result.ok) setError(result.error);
  };

  // Once logged in but forcePasswordChange is true, the dialog takes over
  if (forcePasswordChange) return <ForcePasswordChangeDialog />;

  return (
    <form onSubmit={handleSubmit} className="px-6 py-6 space-y-5">
      {error && (
        <div role="alert" className="border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-mono text-red-400">
          {error}
        </div>
      )}
      <div>
        <label
          htmlFor="lsn-username"
          className="block text-[10px] font-mono tracking-widest text-zinc-500 uppercase mb-1.5"
        >
          Username
        </label>
        <input
          id="lsn-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          autoFocus
          className="w-full bg-black/40 border border-zinc-700 text-zinc-100 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 placeholder:text-zinc-600"
          placeholder="Enter username"
        />
      </div>
      <div>
        <label
          htmlFor="lsn-password"
          className="block text-[10px] font-mono tracking-widest text-zinc-500 uppercase mb-1.5"
        >
          Password
        </label>
        <input
          id="lsn-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full bg-black/40 border border-zinc-700 text-zinc-100 font-mono text-sm px-3 py-2.5 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-amber-500 text-black font-mono text-xs tracking-widest uppercase py-3 hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold"
      >
        {submitting ? "AUTHENTICATING…" : "SIGN IN"}
      </button>
    </form>
  );
}

// ─── Full login screen ────────────────────────────────────────────────────────
export function LoginScreen() {
  return (
    <div className="h-screen w-full bg-[hsl(240,6%,6%)] text-foreground overflow-hidden font-sans relative flex items-center justify-center">
      {/* Watermark — matches AppLayout exactly */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <img
          src={lsnLogo}
          alt=""
          className="absolute w-[clamp(34rem,58vw,52rem)] max-w-none h-auto opacity-[0.025] right-[-6%] bottom-[-16%] select-none"
        />
      </div>
      {/* Paper noise — matches AppLayout */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02] mix-blend-overlay z-0"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")',
        }}
      />
      {/* Login card */}
      <div className="relative z-10 w-full max-w-sm mx-4">
        <div className="border border-zinc-700/60 bg-[hsl(240,6%,9%)] shadow-2xl">
          {/* Card header */}
          <div className="border-b border-zinc-700/60 bg-black/30 px-6 py-5 flex flex-col items-center gap-3">
            <img
              src={saberLogo}
              alt="Saber Industrial Applications"
              className="h-8 w-auto object-contain opacity-90"
            />
            <div className="text-center">
              <div className="text-sm font-bold tracking-wider uppercase text-zinc-100 font-mono">
                LSN Engineering Console
              </div>
              <div className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase mt-0.5">
                v0.1 · Authorised Access Only
              </div>
            </div>
          </div>

          <LoginForm />

          {/* Footer */}
          <div className="border-t border-zinc-700/40 bg-black/20 px-6 py-3">
            <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest text-center">
              Unauthorised access is prohibited · Saber Industrial Applications
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
