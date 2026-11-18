import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ToastContext, type ToastKind } from "./toastContext";

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; kind: ToastKind; id: number } | null>(null);
  const show = useCallback((text: string, kind: ToastKind = "ok") => setMessage({ text, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), message.kind === "error" ? 8000 : 4500);
    return () => window.clearTimeout(timer);
  }, [message]);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="status">
        {message && (
          <div key={message.id} className={`notice toast ${message.kind}`}>
            {message.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
