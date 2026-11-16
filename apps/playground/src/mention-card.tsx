/**
 * The playground's mention interactions' demo: the hover card (the consumer's
 * mini-card over the package's plain host — the design and the data are the
 * harness's stand) and the click's stand (the visible banner + the
 * `window.__mentionClick`'s hook for the e2e's pin). The real card and the
 * click's behavior are the consumer's — the package stands the position and
 * the lifecycle only.
 */
import type { MentionInteractions, MentionMark } from "docblocks-react-ui";

import { useEffect, useReducer } from "react";

import { resolveMentionLabel } from "./mention-provider";

declare global {
  interface Window {
    /** The last chip's click's target (the e2e's pin). */
    __mentionClick?: MentionMark;
  }
}

// The banner's state (module-level — the demo's onClick stands it outside
// React's tree).
const bannerState: { current: MentionMark | null } = { current: null };
const bannerSubs = new Set<() => void>();
function emitBanner(mention: MentionMark | null) {
  bannerState.current = mention;
  bannerSubs.forEach((notify) => notify());
}
function useMentionBanner(): MentionMark | null {
  const [, force] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => {
    bannerSubs.add(force);
    return () => {
      bannerSubs.delete(force);
    };
  }, []);
  return bannerState.current;
}

/** The click's banner (the auto-hide over 2.5s). */
function MentionClickBanner() {
  const click = useMentionBanner();
  useEffect(() => {
    if (click === null) return;
    const timer = setTimeout(() => emitBanner(null), 2500);
    return () => clearTimeout(timer);
  }, [click]);
  if (click === null) return null;
  // The label's stand: the consumer's live resolution over the target's id
  // (the mark is the identity — the label is the consumer's stand).
  const label = resolveMentionLabel(click.kind, click.id) ?? click.label ?? click.id;
  return (
    <div className="db-mention-banner" data-slot="playground/mention-banner">
      Mention click: {label}
    </div>
  );
}

const KIND_LABEL: Record<MentionMark["kind"], string> = {
  user: "Person",
  doc: "Document",
};

const mentionInteractions: MentionInteractions = {
  // The label's stand: the consumer's live resolution over the target's id
  // (the mark is the identity — the label is the consumer's stand; the
  // legacy's label stands the fallback).
  renderCard: (mention) => (
    <div className="db-mention-card-demo">
      <div className="db-mention-card-demo-kind">{KIND_LABEL[mention.kind]}</div>
      <div className="db-mention-card-demo-label">{resolveMentionLabel(mention.kind, mention.id) ?? mention.label}</div>
      <div className="db-mention-card-demo-meta">{mention.id} · demo stand</div>
    </div>
  ),
  onClick: (mention, event) => {
    // The demo keeps the caret in place (the consumer's decision — the
    // package stands no default).
    event.preventDefault();
    window.__mentionClick = mention;
    emitBanner(mention);
  },
};

export { MentionClickBanner, mentionInteractions };
