import { DEMO_USERS } from "../auth/demoUsers";
import { useSession } from "../auth/session";
import { fmt } from "../api/format";

export function SignIn() {
  const session = useSession();
  return (
    <main className="signin">
      <div className="signin-card">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">SC</div>
          <div>
            <div className="brand-name">Supply Chain Control Tower</div>
            <div className="brand-sub">CMPE 272 · enterprise platform</div>
          </div>
        </div>
        <p className="muted">
          Forecasts, stockout risk, reorder and transfer approvals for 500 products across 8 distribution centers.
        </p>
        {session.error && (
          <div className="notice error" role="alert">
            {session.error}
          </div>
        )}
        {session.mode === "oidc" ? (
          <button type="button" className="btn primary" onClick={() => session.signIn()}>
            Sign in with company SSO
          </button>
        ) : (
          <div className="user-pick">
            <div className="eyebrow">Demo mode · choose a user</div>
            {DEMO_USERS.map((user) => (
              <button key={user.username} type="button" className="btn" onClick={() => session.signIn(user.username)}>
                <span>
                  <strong>{user.displayName}</strong> <span className="muted mono">{user.username}</span>
                </span>
                <span className="chip accent">{user.roles.map(fmt.status).join(", ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
