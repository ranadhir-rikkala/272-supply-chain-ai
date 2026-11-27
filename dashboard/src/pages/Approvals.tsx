import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import type { RecommendationKind } from "../api/types";
import { useSession } from "../auth/session";
import { PageHead } from "../components/PageHead";
import { Pager } from "../components/Pager";
import { Empty, ErrorState, Loading } from "../components/States";
import { WarehouseSelect } from "../components/WarehouseSelect";
import { RecommendationCard } from "./RecommendationCard";

const SIZE = 20;
const VIEWS = [
  { id: "open", label: "Waiting", status: "PENDING_REVIEW,PENDING_MANAGER" },
  { id: "manager", label: "Needs manager", status: "PENDING_MANAGER" },
  { id: "decided", label: "Decided", status: "APPROVED,REJECTED" },
];

export function Approvals() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const view = VIEWS.find((v) => v.id === params.get("view")) ?? VIEWS[0];
  const kind = (params.get("kind") ?? "") as RecommendationKind | "";
  const warehouseId = params.get("warehouseId") ?? "";
  const page = Number(params.get("page") ?? 0);

  function update(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  }

  const settings = useQuery({ queryKey: ["settings"], queryFn: ({ signal }) => api.settings(signal) });
  const limit = settings.data?.find((s) => s.key === "planner_limit_usd")?.value ?? 10000;
  const recs = useQuery({
    queryKey: ["recommendations", view.status, kind, warehouseId, page],
    queryFn: ({ signal }) => api.recommendations({ status: view.status, kind, warehouseId, page, size: SIZE }, signal),
    placeholderData: keepPreviousData,
  });

  const intro = session.has("SUPPLY_MANAGER")
    ? "You can approve any order and change quantities. Orders you endorsed need someone else."
    : session.has("PLANNER")
      ? `You can approve orders up to ${fmt.money(limit)}. Larger ones are endorsed and sent to a supply manager.`
      : "Read only. Planners and supply managers make these decisions.";

  return (
    <>
      <PageHead eyebrow="Reorders and transfers" title="Approvals">
        {intro}
      </PageHead>
      <div className="panel filters">
        <div className="btn-row" role="tablist" aria-label="Approval views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view.id}
              className={`btn${v.id === view.id ? " primary" : ""}`}
              onClick={() => update({ view: v.id, page: null })}
            >
              {v.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Type</span>
          <select id="filter-kind" className="input" value={kind} onChange={(e) => update({ kind: e.target.value, page: null })}>
            <option value="">Reorders and transfers</option>
            <option value="REORDER">Reorders</option>
            <option value="TRANSFER">Transfers</option>
          </select>
        </label>
        <label className="field">
          <span>Warehouse</span>
          <WarehouseSelect id="filter-approval-warehouse" value={warehouseId} onChange={(id) => update({ warehouseId: id, page: null })} />
        </label>
      </div>
      {recs.isLoading && <Loading />}
      {recs.error && <ErrorState error={recs.error} retry={() => void recs.refetch()} />}
      {recs.data && recs.data.items.length === 0 && (
        <Empty title={view.id === "decided" ? "Nothing decided yet" : "Nothing waiting"}>
          {view.id === "decided" ? "Approved and rejected items appear here." : "Run optimization to create new recommendations."}
        </Empty>
      )}
      {recs.data && recs.data.items.length > 0 && (
        <>
          <div className="rec-list" style={{ opacity: recs.isPlaceholderData ? 0.6 : 1 }}>
            {recs.data.items.map((rec) => (
              <RecommendationCard key={`${rec.recommendationId}-${rec.version}`} rec={rec} plannerLimit={limit} />
            ))}
          </div>
          <Pager page={page} size={SIZE} total={recs.data.total} onPage={(next) => update({ page: String(next) })} />
        </>
      )}
    </>
  );
}
