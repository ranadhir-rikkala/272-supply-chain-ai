import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WebStorageStateStore } from "oidc-client-ts";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "react-oidc-context";
import { ApiError, configureClient } from "../api/client";
import { api } from "../api/endpoints";
import type { Role } from "../api/types";
import { config } from "../config";
import { hasRole, SessionContext, type Session } from "./session";

const MOCK_KEY = "supplychain.mockUser";

function readMockUser(): string | null {
  try {
    return window.sessionStorage.getItem(MOCK_KEY);
  } catch {
    return null;
  }
}

function writeMockUser(username: string | null) {
  try {
    if (username) window.sessionStorage.setItem(MOCK_KEY, username);
    else window.sessionStorage.removeItem(MOCK_KEY);
  } catch {
    return;
  }
}

function useMe(token: string | null) {
  return useQuery({
    queryKey: ["me", token],
    queryFn: ({ signal }) => api.me(signal),
    enabled: token != null,
    staleTime: Infinity,
    retry: false,
  });
}

function build(
  mode: Session["mode"],
  token: string | null,
  loading: boolean,
  me: ReturnType<typeof useMe>,
  authError: string | null,
  signIn: Session["signIn"],
  signOut: Session["signOut"],
): Session {
  const meError = me.error instanceof ApiError ? me.error.friendly : me.error ? String(me.error) : null;
  const error = authError ?? meError;
  const status: Session["status"] = loading || (token != null && me.isLoading)
    ? "loading"
    : error
      ? "error"
      : token && me.data
        ? "signedIn"
        : "signedOut";
  return {
    mode,
    status,
    me: me.data ?? null,
    error,
    signIn,
    signOut,
    has: (...roles: Role[]) => hasRole(me.data ?? null, roles),
  };
}

function MockSession({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [username, setUsername] = useState<string | null>(readMockUser);
  const token = username ? `mock:${username}` : null;
  configureClient(() => token, () => setUsername(null));
  const me = useMe(token);
  const signIn = useCallback((next?: string) => {
    if (!next) return;
    writeMockUser(next);
    client.clear();
    setUsername(next);
  }, [client]);
  const signOut = useCallback(() => {
    writeMockUser(null);
    client.clear();
    setUsername(null);
  }, [client]);
  const session = useMemo(() => build("mock", token, false, me, null, signIn, signOut), [token, me, signIn, signOut]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

function OidcBridge({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const client = useQueryClient();
  const token = auth.isAuthenticated ? auth.user?.access_token ?? null : null;
  configureClient(() => auth.user?.access_token ?? null, () => {
    void auth.signinRedirect();
  });
  const me = useMe(token);
  const signIn = useCallback(() => {
    void auth.signinRedirect();
  }, [auth]);
  const signOut = useCallback(() => {
    client.clear();
    void auth.signoutRedirect();
  }, [auth, client]);
  const authError = auth.error ? `Sign-in failed: ${auth.error.message}` : null;
  const session = useMemo(
    () => build("oidc", token, auth.isLoading, me, authError, signIn, signOut),
    [token, auth.isLoading, me, authError, signIn, signOut],
  );
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  if (config.useMocks) return <MockSession>{children}</MockSession>;
  const origin = window.location.origin;
  return (
    <AuthProvider
      authority={config.oidcAuthority}
      client_id={config.oidcClientId}
      redirect_uri={`${origin}/`}
      post_logout_redirect_uri={`${origin}/`}
      response_type="code"
      scope="openid profile email"
      automaticSilentRenew
      userStore={new WebStorageStateStore({ store: window.sessionStorage })}
      onSigninCallback={() => window.history.replaceState({}, document.title, window.location.pathname)}
    >
      <OidcBridge>{children}</OidcBridge>
    </AuthProvider>
  );
}
