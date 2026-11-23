/**
 * The cross-block selection's shared pane helpers: the pane/inners/toolbar
 * locators, the doc block reads, the two-block seed, the caret's line-edge
 * seat, and the cross-block selection + DOM selection endpoints.
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The inner contenteditables of the pane's text blocks, in order. */

function inners(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/block-content"]');
}

/** The pane's floating format toolbar. */

function toolbar(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/format-toolbar"]');
}

/** The block ids and texts of the pane's doc, in root order. */

async function blocksOf(page: Page, client: "a" | "b"): Promise<{ id: string; text: string }[]> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const json = doc.toJSON();
    return doc.getChildren(json.id).map((id) => {
      const block = doc.getBlock(id);
      const text = (block?.content ?? []).map((run) => run.text).join("");
      return { id, text };
    });
  }, client);
}

/** The snapshot of one block (the pane's live doc). */

async function blockOf(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ content?: { text: string; marks: Record<string, unknown> }[] } | null> {
  return page.evaluate(({ client, id }) => window.__paneDocs?.[client]?.getBlock(id) ?? null, { client, id });
}

/**
 * Type the room's starter paragraph (pane "a" seeds it once after the
 * sync settles) and a second paragraph (an Enter split at the first
 * block's end), both typed.
 */

async function typeTwoBlocks(page: Page, client: "a" | "b"): Promise<void> {
  await expect(inners(page, client)).toHaveCount(1); // the starter has settled
  await inners(page, client).first().click();
  await page.keyboard.type("hello world");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  // The split lands in the DOM on the next store flush: wait for the new
  // row and re-seat the caret in it (a stale caret in the first block's
  // contenteditable would absorb the early keystrokes).
  await expect(inners(page, client)).toHaveCount(2);
  await inners(page, client).nth(1).click();
  await page.keyboard.type("another world");
}

/**
 * Move the selection's endpoint to the line's edge (the Home/End stand):
 * the firefox engine's contenteditable stands no Home/End's caret move, so
 * the edge's move stands the Selection API's stand (the logical index over
 * the inner's text — the line breaks stand the line's edges, the trailing
 * line-anchor's ZWSP carries no logical character). `start` collapses the
 * selection to its start's line edge; `end` extends the focus to its line's
 * end (the anchor stands).
 */

async function caretToLineEdge(page: Page, edge: "start" | "end"): Promise<void> {
  await page.evaluate((edge) => {
    const sel = window.getSelection();
    if (sel === null || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    // The editable owning the endpoint — not the active element: after a
    // cross extension the browser re-focuses the anchor's editable, the
    // endpoint stands in the far block's inner.
    const endpoint =
      edge === "start" ? { c: r.startContainer, o: r.startOffset } : { c: r.endContainer, o: r.endOffset };
    const endpointHost = endpoint.c.nodeType === Node.TEXT_NODE ? endpoint.c.parentElement : (endpoint.c as Element);
    const inner = endpointHost?.closest?.("[data-slot='docblocks/block-content']") ?? null;
    if (!(inner instanceof HTMLElement) || !inner.isContentEditable) return;
    const isAnchor = (n: Node): boolean =>
      n.nodeType === Node.TEXT_NODE &&
      n.parentElement !== null &&
      n.parentElement.closest("span[data-slot='docblocks/line-anchor']") !== null;
    // The inner's text nodes in document order with their logical lengths.
    const map: { n: Node; start: number; len: number; raw: number }[] = [];
    const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
    let total = 0;
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const raw = n.nodeValue?.length ?? 0;
      const len = isAnchor(n) ? 0 : raw;
      map.push({ n, start: total, len, raw });
      total += len;
    }
    const logicalText = map.reduce((a, e) => (e.len === 0 ? a : a + (e.n.nodeValue ?? "")), "");
    // The selection's endpoint's logical index (the caret's stand for the
    // collapsed, the focus's for the extending).
    const entry = map.find((e) => e.n === endpoint.c);
    const logicalOf = (n: Node): number => {
      if (n.nodeType === Node.TEXT_NODE) return isAnchor(n) ? 0 : (n.nodeValue?.length ?? 0);
      let sum = 0;
      const tw = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let m = tw.nextNode(); m !== null; m = tw.nextNode()) if (!isAnchor(m)) sum += m.nodeValue?.length ?? 0;
      return sum;
    };
    let idx: number;
    if (entry !== undefined) {
      idx = entry.start + (entry.len === 0 ? 0 : endpoint.o);
    } else if (endpoint.c === inner) {
      // The caret on the inner itself (the offset in the child nodes).
      idx = 0;
      for (let i = 0; i < endpoint.o; i += 1) {
        const child = inner.childNodes[i];
        if (child !== undefined) idx += logicalOf(child);
      }
    } else if (endpoint.c.nodeType === Node.ELEMENT_NODE && inner.contains(endpoint.c)) {
      // The caret on a mark's span: the preceding sibling's logical text.
      idx = 0;
      for (let node: Node | null = inner.firstChild; node !== null && node !== endpoint.c; node = node.nextSibling) {
        idx += logicalOf(node);
      }
    } else {
      return;
    }
    let target: number;
    if (edge === "start") {
      const br = logicalText.lastIndexOf("\n", idx - 1);
      target = br === -1 ? 0 : br + 1;
    } else {
      const br = logicalText.indexOf("\n", idx);
      target = br === -1 ? logicalText.length : br;
    }
    // The logical index over the (node, offset)'s stand.
    let acc = 0;
    let targetNode: Node | null = null;
    let targetOff = 0;
    for (const e of map) {
      if (e.len === 0) continue;
      if (acc + e.len > target) {
        targetNode = e.n;
        targetOff = target - acc;
        break;
      }
      acc += e.len;
    }
    if (targetNode === null) {
      const last = map[map.length - 1];
      if (last === undefined) return;
      targetNode = last.n;
      targetOff = last.len === 0 ? last.raw : last.raw;
    }
    const range = document.createRange();
    range.setStart(targetNode, targetOff);
    range.collapse(true);
    if (edge === "start" || sel.anchorNode === null) {
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // The extend's stand over the cross-editable: a Range built from the
      // anchor to the edge endpoint (the engine's setBaseAndExtent clamps
      // the far endpoint into the anchor's own editable — the webkit's
      // stand — and Selection.extend throws over the boundary — the
      // firefox's stand). The document order is stated over a probe range
      // (a backward set is not normalized by the engines).
      const base = sel.anchorNode;
      if (base === null) return;
      const baseProbe = document.createRange();
      baseProbe.setStart(base, sel.anchorOffset);
      baseProbe.collapse(true);
      const targetProbe = document.createRange();
      targetProbe.setStart(targetNode, targetOff);
      targetProbe.collapse(true);
      const baseFirst = baseProbe.compareBoundaryPoints(Range.END_TO_START, targetProbe) <= 0;
      const range = document.createRange();
      if (baseFirst) {
        range.setStart(base, sel.anchorOffset);
        range.setEnd(targetNode, targetOff);
      } else {
        range.setStart(targetNode, targetOff);
        range.setEnd(base, sel.anchorOffset);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, edge);
}

/**
 * Compose the cross-block selection from block 1's start, over `downSteps`
 * blocks, to `rightSteps` into the last block's text (optionally to its
 * end) with the editor's keyboard gestures: the browser cannot extend a
 * selection across a contenteditable boundary (neither a mouse drag nor a
 * native shift+arrow), so the cross range is composed from the editor's
 * shift+arrow edge extensions — caret at the start of block 1 (the line
 * edge's stand over the engine's Home/End's quirk), shift+end to its end,
 * shift+down extends across into the next block (repeated per block),
 * shift+right / shift+end into the last block's text.
 */

async function selectAcrossBlocks(
  page: Page,
  client: "a" | "b",
  rightSteps = 3,
  downSteps = 1,
  toEnd = false
): Promise<void> {
  const box1 = (await inners(page, client).nth(0).boundingBox())!;
  await page.mouse.click(box1.x + 5, box1.y + box1.height / 2);
  await caretToLineEdge(page, "start");
  await page.keyboard.down("Shift");
  for (let i = 0; i < downSteps; i += 1) {
    await caretToLineEdge(page, "end");
    await page.keyboard.press("ArrowDown");
  }
  for (let i = 0; i < rightSteps; i += 1) await page.keyboard.press("ArrowRight");
  if (toEnd) await caretToLineEdge(page, "end");
  await page.keyboard.up("Shift");
}

/** The live DOM selection's endpoints (block id + the container offset); null when none. */

async function domSelection(
  page: Page
): Promise<{ startBlock: string; startOffset: number; endBlock: string; endOffset: number } | null> {
  return page.evaluate(() => {
    const s = window.getSelection();
    if (s === null || s.rangeCount === 0) return null;
    const r = s.getRangeAt(0);
    const blockOf = (node: Node) =>
      (node.parentElement ?? null)?.closest?.("[data-block-id]")?.getAttribute("data-block-id") ?? "";
    return {
      startBlock: blockOf(r.startContainer),
      startOffset: r.startOffset,
      endBlock: blockOf(r.endContainer),
      endOffset: r.endOffset,
    };
  });
}

export { inners, toolbar, blocksOf, blockOf, typeTwoBlocks, selectAcrossBlocks, domSelection };
