/** The motion editor's imperative root attributes: the grip typing flag
 *  (hidden while the editor content is typed) and the enter-animation
 *  gate (rows that mount before the first text input stand up instantly).
 */
import { useEffect, useRef } from "react";

/**
 * The grip typing flag: the editor root holds `data-docblocks-typing` from
 * the first text keypress in its own content until the first pointer move
 * or the focus leaving the editor — the stylesheet's unlayered rule hides
 * the hover grip while the attribute stands (a selected block's grip is a
 * selection indicator and stays visible). The attribute is imperative: a
 * React state would re-render every row per keypress.
 */
function useTypingFlag(rootRef: { current: HTMLDivElement | null }) {
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const setTyping = (typing: boolean) => {
      if (typing) root.setAttribute("data-docblocks-typing", "");
      else root.removeAttribute("data-docblocks-typing");
    };
    const onKeydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || target.closest('[data-slot="docblocks/editor"]') !== root) return;
      if (target.closest('[data-slot="docblocks/block-content"]') === null) return;
      // A text keypress only: a control key (Tab, the arrows, the mod
      // hotkeys) is a gesture, not typing.
      if (event.key.length !== 1 || event.key === "\t" || event.metaKey || event.ctrlKey || event.altKey) return;
      setTyping(true);
    };
    const onPointerMove = () => setTyping(false);
    const onFocusOut = () => {
      const active = document.activeElement;
      if (active instanceof Node && root.contains(active)) return;
      setTyping(false);
    };
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [rootRef]);
}

/**
 * The enter-animation gate: the latch stands on the first text input in
 * this editor (a printable keydown or an input event in the editor's
 * contenteditable) — rows that mount before it (the mount and the sync
 * load) stand up instantly (`initial={false}`: the animate
 * values, no height-growth animation); a row that appears after it is an
 * insert in progress and runs the enter animation. The gate never clears
 * (a load window is a start window, not a session state).
 */
function useEnterAnimationGate(rootRef: { current: HTMLDivElement | null }) {
  const gateRef = useRef(false);
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const inThisEditorText = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target === null) return false;
      if (target.closest('[data-slot="docblocks/editor"]') !== root) return false;
      return target.closest('[data-slot="docblocks/block-content"]') !== null;
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!inThisEditorText(event)) return;
      gateRef.current = true;
    };
    const onInput = (event: Event) => {
      if (!inThisEditorText(event)) return;
      gateRef.current = true;
    };
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("input", onInput);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("input", onInput);
    };
  }, [rootRef]);
  return gateRef;
}

export { useEnterAnimationGate, useTypingFlag };
