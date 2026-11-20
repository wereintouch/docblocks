/**
 * The mention interactions' card layer: the hover card (the consumer's
 * `renderCard` content over a plain portaled host — the package stands the
 * position and the lifecycle only, the design and the data are the
 * consumer's) and the chip's click delivery (the consumer's `onClick`
 * decides what opens; the package opens nothing and stands no default
 * behavior — the event is delivered native). The listeners stand over the
 * document, scoped at event time to this editor's root (a nested editor's
 * stand is its own instance's), so every nested text block and the
 * read-only's stand are covered. The card closes over the pointer's exit
 * (the chip and the card are the hover's zone), the Escape, any scroll
 * (the anchor's shift), and the anchor chip's removal (a MutationObserver
 * over the editor root — the text DOM is imperative, the re-rendered chip
 * stands no React signal).
 */
import { createPortal } from "react-dom";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { MentionMark } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";

const CHIP_SELECTOR = '[data-slot="docblocks/mention"]';
const CARD_SELECTOR = '[data-slot="docblocks/mention-card"]';
const EDITOR_ROOT_SELECTOR = '[data-slot="docblocks/editor"]';

/** The hover's stands: the open's delay (a read-through is not a target)
 *  and the close's grace over the zone's exit (the chip → card's move
 *  stands inside it). */
const HOVER_OPEN_MS = 400;
const HOVER_CLOSE_MS = 150;

/** The card's stand over the anchor (the viewport's fixed coordinates, the
 *  8px's gap, the 8px's viewport margin). */
const CARD_GAP = 8;
const CARD_MARGIN = 8;

interface OpenStand {
  mention: MentionMark;
  /** The anchor chip (the removal's watch target + the position's source). */
  chip: HTMLElement;
  left: number;
  top: number;
  /** False before the first placement (the host measures itself, then
   *  stands visible — no first-frame flash). */
  placed: boolean;
}

/** The target over the chip's attrs (the label is the chip's text — the
 *  icon's svg stands no text of its own). Null over a malformed stand. */
function mentionMarkOf(chip: HTMLElement): MentionMark | null {
  // The mark is the identity (the id-only stand — the label is the
  // consumer's resolution over the id, never the chip's rendered text, which
  // stands the consumer's live label). The chip carries the kind + id.
  const kind = chip.getAttribute("data-mention-kind");
  const id = chip.getAttribute("data-mention-id");
  if ((kind !== "user" && kind !== "doc") || id === null) return null;
  return { kind, id };
}

/** The editor root's mention card layer (the provider's `mentionInteractions`'
 *  stand; the null's stand renders nothing). The returned node is the
 *  portaled host (or null) — the caller renders it over the root. */
function useMentionCard(rootRef: RefObject<HTMLElement | null>): ReactNode {
  const { mentionInteractions } = useEditorContext();
  const [open, setOpen] = useState<OpenStand | null>(null);
  const openRef = useRef<OpenStand | null>(null);
  openRef.current = open;
  const pendingRef = useRef<{ chip: HTMLElement; timer: number } | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const cancelTimers = () => {
    if (pendingRef.current !== null) {
      window.clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // The hover's machine + the click's delivery + the Escape/scroll's close.
  // The listeners stand over the document (the root element's stand at
  // mount stands no listener — the root ref is set post-commit) and scope
  // at event time: the target is this editor root's (a nested editor's
  // stand is excluded — its own instance stands its own card), and the
  // card's hover is this instance's host (the portaled element, outside
  // the root).
  useEffect(() => {
    if (mentionInteractions === null) return;
    const interactions = mentionInteractions;

    /** The event target scoped to this editor's stand; null when the
     *  target stands outside it or over a nested editor's root. */
    const scopedTarget = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      const rootEl = rootRef.current;
      if (rootEl === null || !rootEl.contains(target)) return null;
      const nearestRoot = target.closest(EDITOR_ROOT_SELECTOR);
      if (nearestRoot !== null && nearestRoot !== rootEl) return null;
      return target;
    };

    const over = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const ownCard = hostRef.current;
      if (ownCard !== null && target.closest(CARD_SELECTOR) === ownCard) {
        // The card's hover: the pointer is over the consumer's card content
        // — the close's grace cancels (the chip's target stands).
        if (closeTimerRef.current !== null) {
          window.clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        return;
      }
      const scoped = scopedTarget(target);
      const chip = scoped !== null ? (scoped.closest<HTMLElement>(CHIP_SELECTOR) ?? null) : null;
      if (chip === null) {
        // The exit zone (neither the chip nor the card): the close's grace
        // (a re-entry over the chip or the card cancels it before the fire).
        if (closeTimerRef.current !== null) return;
        if (openRef.current === null && pendingRef.current === null) return;
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          if (pendingRef.current !== null) {
            window.clearTimeout(pendingRef.current.timer);
            pendingRef.current = null;
          }
          setOpen(null);
        }, HOVER_CLOSE_MS);
        return;
      }
      // The chip's hover: the close's grace cancels. The open's delay runs
      // for a new chip (a same-chip hover stands the pending/open stand; a
      // different chip invalidates the previous chip's pending — its open
      // must not fire while the pointer stands over the new one), and the
      // open card closes immediately (the pointer is over a different
      // target).
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      const opened = openRef.current;
      if (chip === opened?.chip) return;
      if (pendingRef.current !== null) {
        if (pendingRef.current.chip === chip) return;
        window.clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
      if (opened !== null) setOpen(null);
      pendingRef.current = {
        chip,
        timer: window.setTimeout(() => {
          pendingRef.current = null;
          const mark = mentionMarkOf(chip);
          if (mark === null) return;
          const rect = chip.getBoundingClientRect();
          setOpen({ mention: mark, chip, left: rect.left, top: rect.top - CARD_GAP, placed: false });
        }, HOVER_OPEN_MS),
      };
    };

    const click = (event: Event) => {
      const scoped = scopedTarget(event.target);
      if (scoped === null) return;
      const chip = scoped.closest<HTMLElement>(CHIP_SELECTOR);
      if (chip === null) return;
      const mark = mentionMarkOf(chip);
      if (mark === null) return;
      // The delivery only (no preventDefault's stand — the consumer's
      // `event.preventDefault()` keeps the caret in place).
      interactions.onClick?.(mark, event as MouseEvent);
    };

    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openRef.current !== null) setOpen(null);
    };
    const scroll = () => {
      // Any scroll shifts the anchor's stand (the page's scroll) — the
      // hover preview's close, not a reposition.
      if (openRef.current !== null) setOpen(null);
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("click", click);
    document.addEventListener("keydown", keydown);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("scroll", scroll, true);
      cancelTimers();
      setOpen(null);
    };
  }, [mentionInteractions, rootRef]);

  // The anchor chip's removal: the text DOM is imperative (the runs-dom's
  // rewrite is no React pass), so a doc change that re-renders the chip
  // (a text edit, a block's removal, the remote's sync) stands no React
  // signal over it — a MutationObserver over the editor root (the chip's
  // ancestor, always connected) stands while the card is open.
  useEffect(() => {
    if (open === null) return;
    const chip = open.chip;
    const rootEl = rootRef.current;
    if (rootEl === null) return;
    const observer = new MutationObserver(() => {
      if (!chip.isConnected) setOpen(null);
    });
    observer.observe(rootEl, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, rootRef]);

  // The placement: the host's first measure (the hidden's stand), then the
  // final's position (the above's stand, the below's flip over the
  // viewport's top, the horizontal's clamp).
  useLayoutEffect(() => {
    if (open === null || open.placed) return;
    const host = hostRef.current;
    if (host === null) return;
    const chipRect = open.chip.getBoundingClientRect();
    const width = host.offsetWidth;
    const height = host.offsetHeight;
    let top = chipRect.top - CARD_GAP - height;
    if (top < CARD_MARGIN) top = chipRect.bottom + CARD_GAP;
    const left = Math.min(
      Math.max(CARD_MARGIN, chipRect.left),
      Math.max(CARD_MARGIN, window.innerWidth - width - CARD_MARGIN)
    );
    setOpen((prev) => (prev !== null && prev.chip === open.chip ? { ...prev, left, top, placed: true } : prev));
  }, [open]);

  // The `renderCard`'s null stand: no card for this target — the host stands
  // nothing (an empty host would be an invisible 0x0 stand).
  let content: ReactNode = null;
  if (open !== null && mentionInteractions !== null) content = mentionInteractions.renderCard(open.mention);
  if (open === null || mentionInteractions === null || content === null) return null;
  return createPortal(
    <div
      ref={hostRef}
      data-slot="docblocks/mention-card"
      data-mention-kind={open.mention.kind}
      data-mention-id={open.mention.id}
      aria-hidden
      className="z-modal"
      style={{
        position: "fixed",
        left: open.left,
        top: open.top,
        width: "fit-content",
        visibility: open.placed ? "visible" : "hidden",
      }}
    >
      {content}
    </div>,
    document.body
  );
}

export { useMentionCard };
