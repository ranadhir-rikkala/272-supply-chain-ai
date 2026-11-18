import { ApiError } from "../api/client";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof ApiError ? error.friendly : "Something went wrong while loading this view.";
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div className="state error" role="alert">
      <strong>Could not load</strong>
      <span>{message}</span>
      {requestId && <span className="mono muted">request {requestId}</span>}
      {retry && (
        <button type="button" className="btn small" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}
