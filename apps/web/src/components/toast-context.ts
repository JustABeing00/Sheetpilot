import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'warning' | 'danger' | 'info';

export interface ToastApi {
  /** Show a transient confirmation or error. Returns the toast id. */
  show: (message: string, tone?: ToastTone) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** Access the app-wide toast queue. Safe to call under the provider mounted in `main.tsx`. */
export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return value;
}
