import { useCallback, useEffect, useState } from "react";
import "./toast.css";

const SHOW_MS = 2500;

interface ToastState {
  text: string;
  visible: boolean;
  /** New id per message, so the same text twice still restarts the timer. */
  id: number;
}

/** Short confirmation at the bottom of a stage. The text stays while it fades out. */
export function useToast(): [ToastState | undefined, (text: string) => void] {
  const [toast, setToast] = useState<ToastState>();
  useEffect(() => {
    if (!toast?.visible) return;
    const timer = window.setTimeout(() => setToast({ ...toast, visible: false }), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const show = useCallback((text: string) => setToast({ text, visible: true, id: Date.now() }), []);
  return [toast, show];
}

export function Toast({ toast }: { toast: ToastState | undefined }) {
  return (
    <div className="toast" role="status" aria-live="polite" data-visible={toast?.visible || undefined}>
      {toast?.text}
    </div>
  );
}
