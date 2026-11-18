import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="panel">
      <div className="state">
        <strong>Page not found</strong>
        <Link to="/">Back to the overview</Link>
      </div>
    </div>
  );
}
