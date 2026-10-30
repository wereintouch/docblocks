/** The editor's theme for one ref'd element, reactive to a theme flip:
 * a single MutationObserver watches the `class` attribute of the
 * element's ancestor chain (collected on mount — the preview's branch
 * swap keeps the same ancestors). A flip re-renders the diagram through
 * the value change (a repeat of the current value is a React no-op). The
 * editor's theme as seen from one element: the `dark` class on the
 * element or any ancestor. */
import { useEffect, useState } from "react";
import type { RefObject } from "react";

/** The editor's theme as seen from one element: the `dark` class on the element or any ancestor. */
function detectEditorTheme(el: Element | null): "light" | "dark" {
  return el !== null && el.closest(".dark") !== null ? "dark" : "light";
}

/**
 * The editor's theme for one ref'd element, reactive to a theme flip:
 * a single MutationObserver watches the `class` attribute of the
 * element's ancestor chain (collected on mount — the preview's branch
 * swap keeps the same ancestors). A flip re-renders the diagram through
 * the value change (a repeat of the current value is a React no-op).
 */
function useContainerTheme<T extends Element>(ref: RefObject<T | null>): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => detectEditorTheme(ref.current));

  useEffect(() => {
    const apply = (): void => setTheme(detectEditorTheme(ref.current));
    apply();
    const targets: Element[] = [];
    for (let node: Element | null = ref.current; node !== null; node = node.parentElement) {
      targets.push(node);
    }
    if (targets.length === 0) return;
    const observer = new MutationObserver(apply);
    for (const target of targets) observer.observe(target, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [ref]);

  return theme;
}

export { useContainerTheme };
