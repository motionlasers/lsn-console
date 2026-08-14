import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { authApi, type SessionUser } from "@/lib/auth-api";

export type { SessionUser };

export interface AuthState {
  user: SessionUser | null;
  /** True while the initial session check is in flight */
  loading: boolean;
  /** True when the server returned a valid session */
  authenticated: boolean;
  /** True when the server requires this user to change their password first */
  forcePasswordChange: boolean;
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  /** Called after a successful forced password-change so the gate clears */
  clearForcePasswordChange: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({
  children,
  initialUser,
  initialForcePasswordChange,
}: {
  children: ReactNode;
  initialUser: SessionUser | null;
  initialForcePasswordChange: boolean;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [forcePasswordChange, setForcePasswordChange] = useState(
    initialForcePasswordChange,
  );

  const login = useCallback(
    async (
      username: string,
      password: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const result = await authApi.login(username, password);
      if (!result.ok) return { ok: false, error: result.error };
      setUser(result.data);
      setForcePasswordChange(result.data.forcePasswordChange);
      return { ok: true };
    },
    [],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setForcePasswordChange(false);
  }, []);

  const clearForcePasswordChange = useCallback(() => {
    setForcePasswordChange(false);
    // Also update the user object so consumers see the updated state
    setUser((prev) =>
      prev ? { ...prev, forcePasswordChange: false } : prev,
    );
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading: false,
        authenticated: user !== null,
        forcePasswordChange,
        login,
        logout,
        clearForcePasswordChange,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
