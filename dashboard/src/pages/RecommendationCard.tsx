import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../api/client";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import type { Recommendation } from "../api/types";
import { useSession } from "../auth/session";
import { RiskChip } from "../components/RiskChip";
import { useToast } from "../components/toastContext";

function History({ id }: { id: string }) {
  const detail = useQuery({ queryKey: ["recommendation", id], queryFn: ({ signal }) => api.recommendation(id, signal) });
  if (detail.isLoading) return <p className="muted">Loading history…</p>;
  if (detail.error) return <p className="muted">History unavailable.</p>;
  const events = detail.data?.data.events ?? [];
  if (events.length === 0) return <p className="muted">No decisions yet.</p>;
  return (
    <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
      {events.map((e) => (
        <li key={e.eventId}>
          <span className="mono">{fmt.time(e.createdAt)}</span> · <strong>{e.actor}</strong> moved it to {fmt.status(e.toStatus)}
          {e.quantityBefore != null && e.quantityAfter != null && e.quantityBefore !== e.quantityAfter && (
            <> (quantity {fmt.int(e.quantityBefore)} → {fmt.int(e.quantityAfter)})</>
          )}
          {e.comment && <span className="muted"> — “{e.comment}”</span>}
        </li>
      ))}
    </ol>
  );
}

export function RecommendationCard({ rec, plannerLimit }: { rec: Recommendation; plannerLimit: number }) {
  const session = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const open = rec.status === "PENDING_REVIEW" || rec.status === "PENDING_MANAGER";
  const manager = session.has("SUPPLY_MANAGER");
  const planner = session.has("PLANNER");
  const me = session.me?.username;
  const aboveLimit = rec.totalValue > plannerLimit;

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["recommendations"] });
    void client.invalidateQueries({ queryKey: ["recommendation", rec.recommendationId] });
    void client.invalidateQueries({ queryKey: ["summary"] });
    void client.invalidateQueries({ queryKey: ["orders"] });
    void client.invalidateQueries({ queryKey: ["warehouses"] });
  };
  const onError = (e: unknown) => {
    setError(e instanceof ApiError ? e.friendly : "The decision could not be saved.");
    if (e instanceof ApiError && (e.status === 409 || e.status === 412)) refresh();
  };
  const approve = useMutation({
    mutationFn: () => api.approve(rec.recommendationId, rec.version, { comment: comment.trim() || undefined }),
    onSuccess: ({ data }) => {
      setError(null);
      toast.show(
        data.recommendation.status === "PENDING_MANAGER"
          ? `Endorsed. ${rec.productName} now waits for a supply manager.`
          : `Approved. Draft order ${data.draftOrderId} created.`,
      );
      refresh();
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: () => api.reject(rec.recommendationId, rec.version, comment.trim()),
    onSuccess: () => {
      setError(null);
      toast.show(`Rejected ${rec.kind === "TRANSFER" ? "transfer" : "reorder"} for ${rec.productName}.`);
      refresh();
    },
    onError,
  });
  const busy = approve.isPending || reject.isPending;

  let blocker: string | null = null;
  if (!planner && !manager) blocker = "Only planners and supply managers can decide.";
  else if (rec.status === "PENDING_MANAGER" && !manager) blocker = `Endorsed by ${rec.endorsedBy}. Waiting for a supply manager.`;
  else if (manager && rec.endorsedBy === me) blocker = "You endorsed this order, so someone else must give final approval.";

  const approveLabel = !manager && aboveLimit ? "Endorse for manager" : "Approve";
  const title =
    rec.kind === "TRANSFER"
      ? `Move ${fmt.int(rec.quantity)} from ${rec.sourceWarehouseId} to ${rec.warehouseId}`
      : `Reorder ${fmt.int(rec.quantity)} for ${rec.warehouseId}`;

  return (
    <article className={`rec ${rec.riskLevel.toLowerCase()}`} aria-label={`${title}, ${rec.productName}`}>
      <div className="rec-top">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{rec.kind === "TRANSFER" ? "Transfer" : "Reorder"} · <span className="mono">{rec.sku}</span></div>
          <h3>{title}</h3>
          <div className="muted">{rec.productName}</div>
        </div>
        <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
          <span className="kpi-value" style={{ fontSize: 22 }}>{fmt.money(rec.totalValue)}</span>
          <span className="btn-row" style={{ gap: 4 }}>
            <RiskChip level={rec.riskLevel} />
            {rec.status === "PENDING_REVIEW" && aboveLimit && <span className="chip medium">Needs manager</span>}
            {rec.status === "PENDING_MANAGER" && <span className="chip medium">Endorsed · needs manager</span>}
            {!open && <span className={`chip ${rec.status === "APPROVED" ? "low" : "neutral"}`}>{fmt.status(rec.status)}</span>}
          </span>
        </div>
      </div>
      <p>{rec.reason}</p>
      <div className="rec-meta">
        {rec.kind === "TRANSFER" ? (
          <>
            <span>{fmt.int(rec.distanceMiles)} miles</span>
            <span>{rec.leadDays} days by truck</span>
            <span>Freight {fmt.money(rec.freightCost)}</span>
          </>
        ) : (
          <>
            <span>Supplier <span className="mono">{rec.supplierId}</span></span>
            <span>{rec.leadDays} day lead time</span>
          </>
        )}
        <span>Arrives {fmt.date(rec.expectedArrival)}</span>
        <span>{fmt.cents(rec.unitCost)} per unit</span>
        {rec.decidedBy && <span>Decided by {rec.decidedBy}</span>}
        <button type="button" className="btn small" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "Hide history" : "History"}
        </button>
      </div>
      {showHistory && <History id={rec.recommendationId} />}
      {open && (
        <div className="rec-actions">
          {blocker ? (
            <p className="muted">{blocker}</p>
          ) : (
            <div className="row">
              <label className="field" style={{ flex: "1 1 260px" }}>
                <span>Comment, required to reject</span>
                <input
                  id={`comment-${rec.recommendationId}`}
                  className="input"
                  type="text"
                  maxLength={500}
                  placeholder="Why approve or reject"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
              <div className="btn-row">
                <button type="button" className="btn primary" disabled={busy} onClick={() => approve.mutate()}>
                  {approve.isPending ? "Saving…" : approveLabel}
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy || comment.trim().length === 0}
                  title={comment.trim().length === 0 ? "Add a comment to reject" : undefined}
                  onClick={() => reject.mutate()}
                >
                  {reject.isPending ? "Saving…" : "Reject"}
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
