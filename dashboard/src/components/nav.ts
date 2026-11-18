import type { Role } from "../api/types";

export interface NavItem {
  to: string;
  label: string;
  roles?: Role[];
}

export const NAV: NavItem[] = [
  { to: "/", label: "Overview" },
  { to: "/map", label: "Supply map" },
  { to: "/risks", label: "Risks" },
  { to: "/approvals", label: "Approvals" },
  { to: "/orders", label: "Orders" },
  { to: "/audit", label: "Audit", roles: ["SUPPLY_MANAGER", "ADMIN"] },
  { to: "/admin", label: "Admin", roles: ["ADMIN"] },
];
