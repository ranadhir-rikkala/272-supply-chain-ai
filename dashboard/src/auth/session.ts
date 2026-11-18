import { createContext, useContext } from "react";
import type { Me, Role } from "../api/types";

export interface Session {
  mode: "oidc" | "mock";
  status: "loading" | "signedOut" | "signedIn" | "error";
  me: Me | null;
  error: string | null;
  signIn: (username?: string) => void;
  signOut: () => void;
  has: (...roles: Role[]) => boolean;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}

export function hasRole(me: Me | null, roles: Role[]): boolean {
  return !!me && roles.some((role) => me.roles.includes(role));
}
