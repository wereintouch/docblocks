// @vitest-environment jsdom
// The document-attributes panel: the page column's
// above-the-first-block stand (collapsed by default, the session state),
// the rows (the system / the preset / the custom), the edit commits, the
// read-only's display-only stand, `hiddenAttributes`, and the canvas
// view's absence.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

interface RenderOptions {
  mode?: "edit" | "view" | "published";
  view?: "page" | "canvas";
  hiddenAttributes?: readonly string[];
  prepare?: (doc: Doc) => void;
}

function renderEditor(options: RenderOptions = {}): Doc {
  const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  if (options.prepare !== undefined) options.prepare(doc);
  render(
    <EditorProvider doc={doc} mode={options.mode} hiddenAttributes={options.hiddenAttributes}>
      <Editor view={options.view ?? "page"} />
    </EditorProvider>
  );
  return doc;
}

/** The panel's root. */
const panel = () => document.querySelector<HTMLElement>('[data-slot="docblocks/attributes"]');
const body = () => document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-body"]');

/** Expands the panel (the toggle's click). */
function expand(): HTMLElement {
  const toggle = document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-toggle"]');
  expect(toggle, "the toggle should be rendered").not.toBeNull();
  act(() => {
    fireEvent.click(toggle!);
  });
  const expanded = body();
  expect(expanded, "the body should stand over the toggle's click").not.toBeNull();
  return expanded!;
}

/** The row of the given key. */
const row = (key: string) =>
  document.querySelector<HTMLElement>(`[data-slot="docblocks/attribute-row"][data-attribute-key="${key}"]`);

afterEach(() => {
  cleanup();
});

describe("the placement and the collapse", () => {
  it("stands inside the page column, above the first block, collapsed by default", () => {
    const doc = renderEditor({ prepare: (d) => d.insertBlock("paragraph") });
    const p = panel();
    expect(p, "the panel should stand over the page's view").not.toBeNull();
    // The page column's island (the above-the-first-block's placement):
    // the panel is over the page's editable, before the block's row.
    const page = document.querySelector<HTMLElement>('[data-slot="docblocks/page"]');
    expect(page?.contains(p)).toBe(true);
    expect(body()).toBeNull(); // the default: collapsed

    expand();
    // The panel precedes the block's row over the column's DOM.
    const blockRow = document.querySelector<HTMLElement>("[data-block-id]");
    expect(blockRow).not.toBeNull();
    expect(p!.compareDocumentPosition(blockRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    void doc;
  });

  it("the canvas view stands no panel", () => {
    renderEditor({ view: "canvas" });
    expect(panel()).toBeNull();
  });
});

describe("the rows", () => {
  it("stands the system rows (id / createdAt / the live lastUpdatedAt)", () => {
    renderEditor();
    const expanded = expand();
    expect(row("id")?.textContent).toContain("doc-1");
    expect(row("createdAt")?.textContent).toContain(CREATED_AT);
    expect(row("updatedAt")).not.toBeNull();
    void expanded;
  });

  it("stands the preset rows and the custom rows over the record", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("description", "The stand");
        d.setAttribute("tags", ["a", "b"]);
        d.setAttribute("author", { id: "u1", label: "Alice" });
        d.setAttribute("status", "draft");
        d.setAttribute("publishedAt", "2026-11-01T00:00:00.000Z");
        d.setAttribute("cover", "file-1");
        d.setAttribute("custom", "custom-value");
      },
    });
    const expanded = expand();
    for (const key of ["description", "tags", "author", "cover", "status", "publishedAt", "custom"]) {
      expect(row(key), `the row of "${key}" should stand`).not.toBeNull();
    }
    expect(row("description")?.textContent).toContain("The stand");
    expect(row("tags")?.textContent).toContain("a");
    expect(row("tags")?.textContent).toContain("b");
    expect(row("author")?.textContent).toContain("Alice");
    expect(row("custom")?.textContent).toContain("custom-value");
    void expanded;
    void doc;
  });
});

describe("the edit commits", () => {
  it("the description's edit commits over the Enter (one setAttribute)", () => {
    const doc = renderEditor({ prepare: (d) => d.setAttribute("description", "old") });
    expand();
    // The edit's entry: the display's click opens the inline input.
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-description"]')!);
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-description-edit"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "new" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(doc.meta.attributes?.description).toBe("new");
  });

  it("the description's commit over the blur; the Escape cancels without a write", () => {
    const doc = renderEditor();
    expand();
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-description"]')!);
    let input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-description-edit"]')!;
    fireEvent.change(input, { target: { value: "blurred" } });
    fireEvent.blur(input);
    expect(doc.meta.attributes?.description).toBe("blurred");

    // The Escape's cancel: the value stands the doc's stand.
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-description"]')!);
    input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-description-edit"]')!;
    fireEvent.change(input, { target: { value: "cancelled" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(doc.meta.attributes?.description).toBe("blurred");
  });

  it("the tags' default editor: the Enter's add, the Backspace's remove, the chip's remove", () => {
    const doc = renderEditor();
    expand();
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-tag-input"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "alpha" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(doc.meta.attributes?.tags).toEqual(["alpha"]);
    // The second tag over the same input (the draft's clear).
    fireEvent.change(input!, { target: { value: "beta" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(doc.meta.attributes?.tags).toEqual(["alpha", "beta"]);

    // The chip's remove (the `x`'s button).
    const chips = document.querySelectorAll<HTMLElement>('[data-slot="docblocks/attributes-tag"]');
    expect(chips).toHaveLength(2);
    const removeOfFirst = chips[0]!.querySelector<HTMLElement>('[data-slot="docblocks/attributes-tag-remove"]');
    expect(removeOfFirst).not.toBeNull();
    fireEvent.click(removeOfFirst!);
    expect(doc.meta.attributes?.tags).toEqual(["beta"]);

    // The empty input's Backspace: the last tag's removal (the stand
    // empties out — the attribute stands removed: an empty list is the
    // field's absent stand).
    fireEvent.keyDown(input!, { key: "Backspace" });
    expect(doc.meta.attributes?.tags).toBeUndefined();
  });

  it("the custom row's remove button stands the removeAttribute", () => {
    const doc = renderEditor({ prepare: (d) => d.setAttribute("custom", "v") });
    expand();
    const customRow = row("custom")!;
    const removeButton = customRow.querySelector<HTMLElement>('[data-slot="docblocks/attribute-row-remove"]');
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton!);
    expect(doc.meta.attributes?.custom).toBeUndefined();
  });

  it("the add row stands the custom key (the reserved key's rejection shows the error, no write)", () => {
    const doc = renderEditor();
    expand();
    const keyInput = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-add-key"]')!;
    const valueInput = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-add-value"]')!;
    fireEvent.change(keyInput, { target: { value: "mykey" } });
    fireEvent.change(valueInput, { target: { value: "myvalue" } });
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-button"]')!);
    expect(doc.meta.attributes?.mykey).toBe("myvalue");

    // The reserved key: the core's rejection stands the inline error (no
    // write, the doc's stand unchanged).
    fireEvent.change(keyInput, { target: { value: "title" } });
    fireEvent.change(valueInput, { target: { value: "no" } });
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-button"]')!);
    expect(doc.meta.title).toBe("T"); // the meta's title stands untouched
    expect(doc.meta.attributes?.title).toBeUndefined();
    expect(document.querySelector<HTMLElement>("[data-slot='docblocks/attributes-body']")?.textContent).toContain(
      "reserved"
    );
  });
});

describe("the consumer's props", () => {
  it("hiddenAttributes hides the named rows (the preset and the system's vocabulary)", () => {
    const doc = renderEditor({
      hiddenAttributes: ["tags", "id", "createdAt"],
      prepare: (d) => {
        d.setAttribute("tags", ["a"]);
        d.setAttribute("description", "d");
      },
    });
    const expanded = expand();
    expect(row("tags")).toBeNull();
    expect(row("id")).toBeNull();
    expect(row("createdAt")).toBeNull();
    expect(row("description")).not.toBeNull();
    expect(row("updatedAt")).not.toBeNull();
    void expanded;
    void doc;
  });

  it("the read-only stand (the view's mode) stands display-only", () => {
    const doc = renderEditor({
      mode: "view",
      prepare: (d) => {
        d.setAttribute("description", "d");
        d.setAttribute("tags", ["a"]);
        d.setAttribute("custom", "v");
      },
    });
    const expanded = expand();
    // No edit entry: the display's stand (no inputs, no remove buttons,
    // no the add row's stand).
    expect(document.querySelector('[data-slot="docblocks/attributes-tag-input"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/attributes-add"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/attribute-row-remove"]')).toBeNull();
    expect(row("description")?.textContent).toContain("d");
    expect(row("custom")?.textContent).toContain("v");
    void expanded;
    void doc;
  });
});
