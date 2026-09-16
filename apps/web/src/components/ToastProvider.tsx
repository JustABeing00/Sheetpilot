import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastContext, type ToastTone } from './toast-context.js';

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

const AUTO_DISMISS_MS = 5000;

/**
 * App-wide, non-blocking feedback for actions that succeed or fail. Toasts auto-dismiss, can be closed
 * with a button, and are announced to assistive tech via a polite live region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss message"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
