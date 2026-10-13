import { useEffect, useId, useRef, type ReactNode } from "react";
import { t } from "../strings";
import "./dialog.css";

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal over the current view: mount it to open, unmount it to close. The page below keeps
 * running (no navigation, players stay connected). Closes with the button, Esc or a tap
 * next to it.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      // Esc: the browser closes the dialog; keep React in charge of unmounting it.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // The dialog element covers only its box; a click on it directly is the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-body">
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose}>
            {t.dialog.close}
          </button>
        </header>
        <div className="dialog-content">{children}</div>
      </div>
    </dialog>
  );
}
