import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { configureClient } from "../api/client";
import type { Role } from "../api/types";
import { DEMO_USERS } from "../auth/demoUsers";
import { hasRole, SessionContext, type Session } from "../auth/session";
import { ToastProvider } from "../components/Toast";

export function renderAs(username: string, ui: ReactNode, path = "/") {
  const user = DEMO_USERS.find((u) => u.username === username)!;
  configureClient(() => `mock:${username}`, () => undefined);
  const me = { username: user.username, displayName: user.displayName, email: null, roles: user.roles };
  const session: Session = {
    mode: "mock",
    status: "signedIn",
    me,
    error: null,
    signIn: () => undefined,
    signOut: () => undefined,
    has: (...roles: Role[]) => hasRole(me, roles),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
        </ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
}
