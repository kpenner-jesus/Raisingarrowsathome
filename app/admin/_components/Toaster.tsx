"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface Toast { id: number; message: string; tone: "success" | "error"; }

interface ToastApi {
  notify: (message: string, tone?: "success" | "error") => void;
}

const ToastContext = createContext<ToastApi>({ notify: () => {} });

export function useToast() { return useContext(ToastContext); }

let nextId = 1;

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => {
    const id = nextId++;
    setToasts((curr) => [...curr, { id, message, tone }]);
    setTimeout(() => setToasts((curr) => curr.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="ra-toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`ra-toast ${t.tone === "error" ? "ra-toast-error" : ""}`}>
            <span className="ra-toast-dot" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
