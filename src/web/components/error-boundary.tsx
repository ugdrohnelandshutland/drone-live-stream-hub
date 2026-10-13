import { Component, type ReactNode } from "react";
import { t } from "../strings";
import { Notice } from "./notice";

const RELOAD_AFTER_MS = 10_000;

interface State {
  failed: boolean;
}

/**
 * Last line of defence: a render error must not leave the kiosk on a blank screen. Shows a
 * message and reloads the page after a few seconds.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };
  private timer: number | undefined;

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("render failed", error);
    this.timer = window.setTimeout(() => location.reload(), RELOAD_AFTER_MS);
  }

  override componentWillUnmount(): void {
    window.clearTimeout(this.timer);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <Notice title={t.crash.title} detail={t.crash.detail}>
          <p>
            <button type="button" onClick={() => location.reload()}>
              {t.crash.reload}
            </button>
          </p>
        </Notice>
      </main>
    );
  }
}
