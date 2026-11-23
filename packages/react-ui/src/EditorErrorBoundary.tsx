/**
 * The editor's top-level render boundary: a synchronous throw outside a
 * block's renderer (the attributes panel, the canvas chrome, the row list's
 * logic) is contained to the editor — the consumer's application stays
 * mounted and the failure note stands a retry. The per-block
 * `BlockErrorBoundary` keeps the narrower stand: a failed block leaves the
 * rest of the page editable.
 *
 * `resetKey` is the consumer's recovery trigger (a change re-renders the
 * failed content); `fallback` replaces the built-in note.
 */
import { useTranslation } from "react-i18next";

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { Button } from "./shared/ui/Button";

interface EditorErrorFallbackProps {
  onRetry: () => void;
}

/** The built-in failure note (the retry re-renders the editor's content). */
function EditorErrorFallback({ onRetry }: EditorErrorFallbackProps) {
  const { t } = useTranslation("editor");
  return (
    <div
      data-slot="docblocks/editor-error"
      role="alert"
      className="flex flex-col items-start gap-2 p-4 text-xs text-muted-foreground"
    >
      <span>{t("error.editor")}</span>
      <Button data-slot="docblocks/editor-error-retry" variant="outline" size="sm" onClick={onRetry}>
        {t("error.retry")}
      </Button>
    </div>
  );
}

interface EditorErrorBoundaryProps {
  children: ReactNode;
  /** The consumer's replacement for the built-in note. */
  fallback?: (props: { error: unknown; retry: () => void }) => ReactNode;
  /** The reset key: a change re-renders the failed content. */
  resetKey?: unknown;
}

interface EditorErrorBoundaryState {
  error: unknown;
  failed: boolean;
}

class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
  state: EditorErrorBoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): EditorErrorBoundaryState {
    return { error, failed: true };
  }

  componentDidUpdate(prev: EditorErrorBoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, failed: false });
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[docblocks] the editor's chrome threw — the failure note stands", info, error);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const retry = () => this.setState({ error: null, failed: false });
    return this.props.fallback !== undefined ? (
      this.props.fallback({ error: this.state.error, retry })
    ) : (
      <EditorErrorFallback onRetry={retry} />
    );
  }
}

export { EditorErrorBoundary };
export type { EditorErrorBoundaryProps };
