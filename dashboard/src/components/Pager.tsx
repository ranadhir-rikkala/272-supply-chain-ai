import { fmt } from "../api/format";

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : page * size + 1;
  const last = Math.min(total, (page + 1) * size);
  return (
    <nav className="pager" aria-label="Pagination">
      <span>
        {fmt.int(first)}–{fmt.int(last)} of {fmt.int(total)}
      </span>
      <span className="btn-row">
        <button type="button" className="btn small" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="mono">
          {page + 1} / {pages}
        </span>
        <button type="button" className="btn small" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </span>
    </nav>
  );
}
