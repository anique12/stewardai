/**
 * Minimal pub/sub for the toast host (`components/app-shell/Toast.tsx`).
 * Any client component can call `showToast(...)` without needing a context
 * provider — the single `<Toast />` mounted in `AppChrome` subscribes and
 * renders whatever's pushed.
 */

export type ToastPayload = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

type Listener = (toast: ToastPayload) => void;

const listeners = new Set<Listener>();

export function showToast(payload: ToastPayload) {
  listeners.forEach((listener) => listener(payload));
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
