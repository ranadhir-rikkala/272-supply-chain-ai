import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import { useSession } from "../auth/session";
import { NAV } from "./nav";
import { ThemeToggle } from "./ThemeToggle";

export function Layout() {
  const session = useSession();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const summary = useQuery({ queryKey: ["summary"], queryFn: ({ signal }) => api.summary(signal) });
  const pending = summary.data ? summary.data.approvals.pendingReview + summary.data.approvals.pendingManager : null;
  const items = NAV.filter((item) => !item.roles || session.has(...item.roles));

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="app">
      <div className="mobile-bar">
        <button type="button" className="btn small" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen((v) => !v)}>
          Menu
        </button>
        <span className="brand-name">Control Tower</span>
      </div>
      <aside id="sidebar" className={`sidebar${open ? " open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">SC</div>
          <div>
            <div className="brand-name">Control Tower</div>
            <div className="brand-sub">Supply chain AI</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => (isActive ? "active" : undefined)}>
              <span>{item.label}</span>
              {item.to === "/approvals" && pending != null && pending > 0 && (
                <span className="count" aria-label={`${pending} pending`}>
                  {pending}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {session.mode === "mock" && <span className="chip medium">Demo data</span>}
          <div className="user">
            <span className="user-name">{session.me?.displayName}</span>
            <span className="muted mono">{session.me?.username}</span>
            <div className="role-list">
              {session.me?.roles.map((role) => (
                <span key={role} className="chip accent">
                  {fmt.status(role)}
                </span>
              ))}
            </div>
          </div>
          <ThemeToggle />
          <button type="button" className="btn" onClick={session.signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
