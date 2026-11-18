import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireRole } from "./components/RequireRole";
import { Admin } from "./pages/Admin";
import { Approvals } from "./pages/Approvals";
import { Audit } from "./pages/Audit";
import { NotFound } from "./pages/NotFound";
import { Orders } from "./pages/Orders";
import { Overview } from "./pages/Overview";
import { Risks } from "./pages/Risks";
import { SupplyMap } from "./pages/SupplyMap";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="map" element={<SupplyMap />} />
        <Route path="risks" element={<Risks />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="orders" element={<Orders />} />
        <Route
          path="audit"
          element={
            <RequireRole roles={["SUPPLY_MANAGER", "ADMIN"]}>
              <Audit />
            </RequireRole>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole roles={["ADMIN"]}>
              <Admin />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
