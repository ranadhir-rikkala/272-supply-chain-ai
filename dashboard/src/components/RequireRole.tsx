import type { ReactNode } from "react";
import type { Role } from "../api/types";
import { fmt } from "../api/format";
import { useSession } from "../auth/session";

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const session = useSession();
  if (session.has(...roles)) return <>{children}</>;
  return (
    <div className="panel">
      <div className="state">
        <strong>Not available for your role</strong>
        <span>This page needs {roles.map(fmt.status).join(" or ")}.</span>
      </div>
    </div>
  );
}
