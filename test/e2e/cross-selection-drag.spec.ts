// The cross range over the mouse and the clipboard — the drag's composition
// (the in-block drag's stand) and the copy's serialize from the doc (the
// default copy cannot cross the boundary).
import { type Page, expect, test } from "@playwright/test";

import {
  blockOf,
  blocksOf,
  domSelection,
  inners,
  selectAcrossBlocks,
  toolbar,
  typeTwoBlocks,
} from "./cross-selection-helpers";
import { twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

async function dragAcrossBlocks(page: Page, client: "a" | "b"): Promise<void> {
  const first = (await inners(page, client).nth(0).boundingBox())!;
  const second = (await inners(page, client).nth(1).boundingBox())!;
  await page.mouse.move(first.x + 6, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + 6, second.y + second.height / 2, { steps: 8 });
}

test("a cross copy serializes the range from the doc (the default copy cannot cross the boundary)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "c5d-cross-copy", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  // Mark block 1's head so the payload carries a mark tag.
  await a.evaluate((id) => window.__paneDocs?.a?.setMark(id, 0, 5, { type: "bold" }), first.id);

  // (block 1, 0) to (block 2, 5): block 1 is fully covered, block 2 is
  // cut after its head.
  await selectAcrossBlocks(a, "a", 5, 1, false);
  const sel = await domSelection(a);
  expect(sel!.startBlock).toBe(first.id);
  expect(sel!.endBlock).toBe(second.id);

  // Dispatch a copy event on the focused inner and read what the editor
  // put on the clipboard (headless Chromium does not run the default copy
  // for a cross-boundary selection, and the copy side is simulated per
  // the clipboard spec's convention).
  const data = await a.evaluate(() => {
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the copy target should be focused");
    const transfer = new DataTransfer();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      text: transfer.getData("text/plain"),
      html: transfer.getData("text/html"),
    };
  });

  expect(data.prevented).toBe(true);
  expect(data.text).toBe("hello world\n" + second.text.slice(0, sel!.endOffset));
  expect(data.html).toBe(`<div><strong>hello</strong> world</div><div>${second.text.slice(0, sel!.endOffset)}</div>`);
  await close();
});

test("a mouse drag composes the cross selection (and the in-block drag stands)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5d-cross-drag", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  // Cross drag: the selection stands across the boundary mid-drag and
  // keeps standing after the release (the editor re-seats it over the
  // suppressed browser seat).
  await dragAcrossBlocks(a, "a");
  const during = await domSelection(a);
  expect(during!.startBlock).toBe(first.id);
  expect(during!.endBlock).toBe(second.id);
  await a.mouse.up();
  const after = (await domSelection(a))!;
  expect(after.startBlock).toBe(first.id);
  expect(after.endBlock).toBe(second.id);
  // The toolbar stands over the cross range, and the document focus stands
  // inside the editor (the page's single editable container — the caret's
  // anchor block is the dragged range's block, the keys bubble to the root
  // handlers regardless of the caret's block).
  await expect(toolbar(a, "a")).toBeVisible();
  const anchorBlock = await a.evaluate(() => {
    const selection = window.getSelection();
    if (selection === null || selection.anchorNode === null) return "";
    const host =
      selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? (selection.anchorNode as Element)
        : (selection.anchorNode.parentElement ?? null);
    return host?.closest("[data-block-id]")?.getAttribute("data-block-id") ?? "";
  });
  expect([first.id, second.id]).toContain(anchorBlock);
  // The shared page editable: the native highlight crosses the blocks'
  // boundaries natively over every engine (the WebKit family's clamp only
  // applies between sibling editables) — no overlay segments over any.
  const rootA = a.locator('[data-slot="docblocks/editor"]').first();
  await expect(rootA.locator('[data-slot="docblocks/selection-segment"]')).toHaveCount(0);

  // The delete of the dragged range removes the covered text over the
  // wire: the endpoint blocks keep their uncovered parts (block 1 the
  // head before the drag start, block 2 the tail after the drag end),
  // nothing in between (there is nothing in between).
  const [firstText, secondText] = [first.text, second.text];
  await a.keyboard.press("Delete");
  await expect
    .poll(async () => {
      const texts = (await blocksOf(b, "b")).map((t) => t.text);
      return (
        JSON.stringify(texts) ===
        JSON.stringify([firstText.slice(0, during!.startOffset), secondText.slice(during!.endOffset)])
      );
    })
    .toBe(true);
  expect((await blockOf(a, "a", first.id))?.content?.map((run) => run.text).join("")).toBe(
    firstText.slice(0, during!.startOffset)
  );

  // An in-block-only drag leaves a plain in-block range (no cross takeover).
  const innersA = inners(a, "a");
  const box = (await innersA.nth(0).boundingBox())!;
  await a.mouse.move(box.x + 4, box.y + box.height / 2);
  await a.mouse.down();
  await a.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 5 });
  const inBlock = (await domSelection(a))!;
  expect(inBlock.startBlock).toBe(inBlock.endBlock);
  await a.mouse.up();

  // A click without a drag seats the caret: typing lands where it stands.
  await innersA.nth(0).click();
  await a.keyboard.type("Z");
  expect((await blockOf(a, "a", first.id))?.content?.map((run) => run.text).join("")).toContain("Z");
  await close();
});
