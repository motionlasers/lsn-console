import { useState, useEffect, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LoginScreen, ForcePasswordChangeDialog } from "@/components/LoginScreen";
import { authApi, type SessionUser } from "@/lib/auth-api";

interface GateState {
  loading: boolean;
  user: SessionUser | null;
  forcePasswordChange: boolean;
}

/**
 * Inner shell: decides whether to show the login screen, a forced-password
 * change overlay, or the full app.
 * All state derives from the DB-authoritative AuthContext.
 */
function AuthShell({ children }: { children: ReactNode }) {
  const { authenticated, forcePasswordChange } = useAuth();

  if (!authenticated) return <LoginScreen />;

  // Authenticated but must change password first — block the app with an overlay
  if (forcePasswordChange) {
    return (
      <>
        <div
          className="h-screen w-full pointer-events-none opacity-20 overflow-hidden"
          aria-hidden="true"
        >
          {children}
        </div>
        <ForcePasswordChangeDialog />
      </>
    );
  }

  return <>{children}</>;
}

/**
 * Outer gate: checks session on mount, then renders the appropriate state.
 * initialForcePasswordChange is populated from the /api/auth/session response
 * so it is correct after page reload.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({
    loading: true,
    user: null,
    forcePasswordChange: false,
  });

  useEffect(() => {
    authApi.getSession().then((result) => {
      if (result.ok) {
        setState({
          loading: false,
          user: result.data,
          forcePasswordChange: result.data.forcePasswordChange,
        });
      } else {
        setState({ loading: false, user: null, forcePasswordChange: false });
      }
    });
  }, []);

  if (state.loading) {
    return (
      <div className="h-screen w-full bg-[hsl(240,6%,6%)] flex items-center justify-center">
        <div className="text-[10px] font-mono text-zinc-600 tracking-widest uppercase animate-pulse">
          Initialising…
        </div>
      </div>
    );
  }

  return (
    <AuthProvider
      initialUser={state.user}
      initialForcePasswordChange={state.forcePasswordChange}
    >
      <AuthShell>{children}</AuthShell>
    </AuthProvider>
  );
}
