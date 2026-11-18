import type { Role } from "../api/types";

export const DEMO_USERS: { username: string; displayName: string; roles: Role[] }[] = [
  { username: "vic.viewer", displayName: "Vic Viewer", roles: ["VIEWER"] },
  { username: "pat.planner", displayName: "Pat Planner", roles: ["PLANNER"] },
  { username: "max.manager", displayName: "Max Manager", roles: ["SUPPLY_MANAGER"] },
  { username: "ada.admin", displayName: "Ada Admin", roles: ["ADMIN"] },
];
