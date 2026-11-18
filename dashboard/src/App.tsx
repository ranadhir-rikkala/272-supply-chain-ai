import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { ApiError } from "./api/client";
import { SessionProvider } from "./auth/SessionProvider";
import { useSession } from "./auth/session";
import { Loading } from "./components/States";
import { SignIn } from "./pages/SignIn";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
    },
  });
}

function Gate() {
  const session = useSession();
  if (session.status === "loading") return <Loading label="Signing in" />;
  if (session.status !== "signedIn" || !session.me) return <SignIn />;
  return (
    <main className="signin">
      <div className="signin-card">
        <h1>Signed in as {session.me.displayName}</h1>
        <button type="button" className="btn" onClick={session.signOut}>
          Sign out
        </button>
      </div>
    </main>
  );
}

export function App() {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}

