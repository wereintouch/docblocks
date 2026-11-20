import type { Browser } from "@playwright/test";

/**
 * A browser context over the harness's pages with the engine stands
 * installed (the Home/End stand — the firefox and the webkit engines
 * do not run the native Home/End caret move in a contenteditable, so
 * the capture-phase stand moves the caret to the line's edge). The
 * specs' pane helpers take their contexts from here so the stands reach
 * every page.
 */
function homeEndStandEngine(browser: Browser): boolean {
  const name = browser.browserType().name();
  return name === "firefox" || name === "webkit";
}

/**
 * The Home/End stand for the engines whose contenteditable does not run
 * the native caret move (firefox and webkit): the arrow keys work, but
 * Home/End are no-ops there, so the capture-phase stand moves the caret
 * to the line's edge (the browser default's effect) and extends the
 * selection's focus over a shift hold. The line is the logical text's
 * break (the trailing line-anchor's ZWSP carries no logical character).
 * The install runs as the page's init script (before the navigation): it
 * patches the engine's gap only — the product keeps the browser's
 * default, and the real engines' keys work.
 */
const HOME_END_STAND = `(() => {
  const isLineAnchorText = (n) =>
    n !== null &&
    n.nodeType === Node.TEXT_NODE &&
    n.parentElement !== null &&
    n.parentElement.closest("span[data-slot='docblocks/line-anchor']") !== null;
  const logicalLengthOf = (n) => {
    if (n.nodeType === Node.TEXT_NODE) return isLineAnchorText(n) ? 0 : (n.nodeValue !== null ? n.nodeValue.length : 0);
    let sum = 0;
    const tw = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    for (let m = tw.nextNode(); m !== null; m = tw.nextNode()) {
      if (!isLineAnchorText(m)) sum += m.nodeValue !== null ? m.nodeValue.length : 0;
    }
    return sum;
  };
  const lineEdge = (inner, endpoint, isStart) => {
    const map = [];
    let total = 0;
    const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const raw = n.nodeValue !== null ? n.nodeValue.length : 0;
      const len = isLineAnchorText(n) ? 0 : raw;
      map.push({ n, start: total, len, raw });
      total += len;
    }
    const logical = map.reduce((a, e) => (e.len === 0 ? a : a + (e.n.nodeValue ?? "")), "");
    const entry = map.find((e) => e.n === endpoint.c);
    let idx;
    if (entry !== undefined) {
      idx = entry.start + (entry.len === 0 ? 0 : endpoint.o);
    } else if (endpoint.c === inner) {
      idx = 0;
      for (let i = 0; i < endpoint.o; i += 1) {
        const child = inner.childNodes[i];
        if (child !== undefined) idx += logicalLengthOf(child);
      }
    } else if (endpoint.c.nodeType === Node.ELEMENT_NODE && inner.contains(endpoint.c)) {
      idx = 0;
      for (let node = inner.firstChild; node !== null && node !== endpoint.c; node = node.nextSibling) {
        idx += logicalLengthOf(node);
      }
    } else {
      return null;
    }
    const br = isStart ? logical.lastIndexOf("\\n", idx - 1) : logical.indexOf("\\n", idx);
    const target = isStart ? (br === -1 ? 0 : br + 1) : br === -1 ? logical.length : br;
    let acc = 0;
    for (const e of map) {
      if (e.len === 0) continue;
      if (acc + e.len > target) return { node: e.n, off: target - acc };
      acc += e.len;
    }
    const last = map[map.length - 1];
    return last !== undefined ? { node: last.n, off: last.raw } : null;
  };
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Home" && event.key !== "End") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const sel = window.getSelection();
      if (sel === null || sel.rangeCount === 0) return;
      const extending = event.shiftKey;
      // A plain key over a non-collapsed selection: the browser's stand.
      if (!extending && !sel.isCollapsed) return;
      // The shift's extend stands the selection's anchor (the caret's
      // stand over the collapse); the plain key's stand takes the caret
      // (the anchor over the collapse).
      const endpoint = { c: sel.anchorNode, o: sel.anchorOffset };
      if (endpoint.c === null) return;
      const host = endpoint.c.nodeType === Node.TEXT_NODE ? endpoint.c.parentElement : endpoint.c;
      const inner = host && host.closest ? host.closest("[data-slot='docblocks/block-content']") : null;
      if (inner === null || !inner.isContentEditable) return;
      const pos = lineEdge(inner, endpoint, event.key === "Home");
      if (pos === null) return;
      event.preventDefault();
      if (extending) {
        sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, pos.node, pos.off);
        return;
      }
      const range = document.createRange();
      range.setStart(pos.node, pos.off);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    },
    true
  );
})();`;

export { HOME_END_STAND, homeEndStandEngine };
