import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, insertBlockType, openPane } from "./helpers";

/**
 * The security stand of the `./mermaid` subpath: the one
 * `dangerouslySetInnerHTML` of the package injects the `mermaid.render`'s
 * svg over the strict-security config (the source sanitized, no click
 * handlers or foreign scripts bound). This suite pins that stand over the
 * shipped dist (the browser's render — jsdom's layout pass stands no
 * `getBBox`): every hostile source stands a rendered diagram (or a parse
 * error, which is safe too) and never stands a live script, an event
 * handler, or an active `javascript:` URL in the injected svg.
 *
 * Each source carries its own node label (`nN`) — the freshness stand:
 * the previous svg stays put while the (re-)render runs, so the source's
 * marker landing in the svg is the fresh-render's signal.
 */
const HOSTILE_SOURCES: Array<{ name: string; source: string; marker: string }> = [
  {
    name: "the click callback binding",
    source: 'flowchart TD\n  A["n0"]\n  click A callback',
    marker: "n0",
  },
  {
    name: "the click's javascript: href",
    source: 'flowchart TD\n  A["n1"]\n  click A "javascript:alert(1)"',
    marker: "n1",
  },
  {
    name: "the script tag in the label",
    source: 'flowchart TD\n  A["n2<script>alert(1)</script>"]',
    marker: "n2",
  },
  {
    name: "the event handler in the label",
    source: 'flowchart TD\n  A["n3<img src=x onerror=alert(1)>"]',
    marker: "n3",
  },
  {
    name: "the javascript: URL in the label's link",
    source: "flowchart TD\n  A[\"n4<a href='javascript:alert(1)'>link</a>\"]",
    marker: "n4",
  },
  {
    name: "the security downgrade's init directive",
    source: '%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A["n5<img src=x onerror=alert(1)>"]',
    marker: "n5",
  },
  {
    name: "the entity-encoded script",
    source: 'flowchart TD\n  A["n6&#60;script&#62;alert(1)&#60;/script&#62;"]',
    marker: "n6",
  },
  {
    name: "the script tag in the sequence message",
    source: "sequenceDiagram\n  n7->>Bob: <script>alert(1)</script>",
    marker: "n7",
  },
];

/** The pane's mermaid block wrapper. */
function mermaidBlock(page: Page) {
  return page.locator('[data-testid="doc-a"]').locator('[data-block-type="code"][data-language="mermaid"]');
}

/** The diagram's own svg (the error state's alert icon is a different
 *  svg; the diagram stands in its own slot). */
async function svgState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('[data-testid="doc-a"] [data-slot="docblocks/mermaid"]');
    if (container === null) return { state: "missing" as const, svg: "" };
    const state = container.dataset.state ?? "unknown";
    const svg = container.querySelector('[data-slot="docblocks/mermaid-diagram"] svg');
    return { state, svg: svg === null ? "" : svg.outerHTML };
  });
}

/** Paste a plain-text payload into the focused element (the multi-line
 *  input route for code blocks — headless Chromium does not synthesize a
 *  paste from Control+v). */
async function pastePlainText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", value);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  }, text);
}

/** Replace the block's text with the hostile source (the code mode's
 *  select-all + delete + paste) and stand the preview mode. */
async function setHostileSource(page: Page, source: string): Promise<void> {
  const block = mermaidBlock(page);
  // The code mode (the preview's exclusive stand — the editable stands
  // there).
  await block.first().hover();
  await block.first().locator('[data-mermaid-mode-button="code"]').click();
  const inner = block.locator('[data-slot="docblocks/block-content"]');
  await inner.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await pastePlainText(page, source);
  await block.first().hover();
  await block.first().locator('[data-mermaid-mode-button="preview"]').click();
}

test("the hostile sources stand no live script, handler, or active URL in the rendered svg", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  // The execution canary: a hostile payload that ever RUNS stands a
  // dialog (the alert's stand) — the dismissal records it.
  const dialogs: string[] = [];
  a.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  try {
    // A unique room per run (the relay keeps the room's doc for the dev
    // server's lifetime; the room's blocks stand this suite's only).
    await openPane(a, "a", `mermaid-sec-${Math.random().toString(36).slice(2, 8)}`);
    await insertBlockType(a, "a", "code-mermaid");
    // The rendered-diagram count (the vacuity's stand: the all-errors
    // outcome would pass the security's assertion on nothing).
    let diagramRenders = 0;

    for (const { name, source, marker } of HOSTILE_SOURCES) {
      await setHostileSource(a, source);
      // The render settles: the parse error (safe) or the fresh diagram —
      // the previous svg stands while the (re-)render runs, so the
      // freshness stands on the source's own marker landing in the svg.
      await expect
        .poll(
          async () => {
            const { state, svg } = await svgState(a);
            if (state === "error") return true;
            return state === "diagram" && svg.includes(marker);
          },
          { timeout: SETTLE.timeout }
        )
        .toBe(true);
      const { state, svg } = await svgState(a);
      if (state !== "diagram") {
        // The parse error stands the safe stand (no svg injected).
        continue;
      }
      diagramRenders += 1;
      // The svg carries no live script / handler / active URL: the
      // assertion over the parsed node itself (the outerHTML's string
      // stand would pass on an escaped entity; the DOM's stand is the one
      // that executes).
      const violations = await a.evaluate((markup: string) => {
        const template = document.createElement("template");
        template.innerHTML = markup;
        const root = template.content;
        const problems: string[] = [];
        // The live script elements (the injection's execution surface).
        for (const script of Array.from(root.querySelectorAll("script"))) {
          problems.push(`script: ${script.outerHTML}`);
        }
        // The event handler attributes (the on* stand) and the active
        // URLs (the javascript: stand) over every attribute (the xlink:
        // href is a namespaced attribute — the attribute walk covers it).
        for (const element of Array.from(root.querySelectorAll("*"))) {
          for (const attribute of Array.from(element.attributes)) {
            if (/^on[a-z]+$/i.test(attribute.name)) {
              problems.push(`handler: ${element.tagName.toLowerCase()}@${attribute.name}="${attribute.value}"`);
            }
            if (/^(xlink:)?href$/i.test(attribute.name) && /^javascript:/i.test(attribute.value.trim())) {
              problems.push(`url: ${element.tagName.toLowerCase()}@${attribute.name}="${attribute.value}"`);
            }
          }
        }
        return problems;
      }, svg);
      expect(violations, `the hostile source "${name}" stands a live surface:\n${violations.join("\n")}`).toEqual([]);
    }
    // Every source stands the rendered diagram (a parse-failure over one
    // would thin the pin's coverage — the strict's stand is asserted on
    // the rendered svg, not on the parse's refusal).
    expect(diagramRenders).toBe(HOSTILE_SOURCES.length);
    // Nothing over the whole suite ever executed.
    expect(dialogs, `a hostile payload executed (${dialogs.join("; ")})`).toEqual([]);
  } finally {
    await context.close();
  }
});
