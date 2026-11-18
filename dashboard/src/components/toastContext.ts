import { createContext, useContext } from "react";

export type ToastKind = "ok" | "error";

export const ToastContext = createContext<{ show: (text: string, kind?: ToastKind) => void }>({ show: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}
