// @vitest-environment jsdom
// The document-attributes panel: the page column's
// above-the-first-block stand (collapsed by default, the session state),
// the rows (the system / the preset / the custom), the edit commits, the
// read-only's display-only stand, `hiddenAttributes`, and the canvas
// view's absence.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc, fromJSON } from "docblocks-core";
import type { AttributeType, Doc, DocJSON } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import type { RenderAttributeProps } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

interface RenderOptions {
  doc?: Doc;
  mode?: "edit" | "view" | "published";
  view?: "page" | "canvas";
  hiddenAttributes?: readonly string[];
  prepare?: (doc: Doc) => void;
  renderAttribute?: (props: RenderAttributeProps) => React.ReactNode;
  attributeTypePicker?: React.ComponentType<{
    value: AttributeType;
    onChange: (type: AttributeType) => void;
  }>;
}

function renderEditor(options: RenderOptions = {}): Doc {
  const doc = options.doc ?? createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  if (options.prepare !== undefined) options.prepare(doc);
  render(
    <EditorProvider
      doc={doc}
      mode={options.mode}
      hiddenAttributes={options.hiddenAttributes}
      renderAttribute={options.renderAttribute}
      attributeTypePicker={options.attributeTypePicker}
    >
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
  it("stands the system rows (id / createdAt / the live lastUpdatedAt — the locale's date stand)", () => {
    renderEditor();
    const expanded = expand();
    expect(row("id")?.textContent).toContain("doc-1");
    // The date stand (the locale's medium date — not the raw ISO): the
    // year stands, the ISO's `T` separator does not.
    expect(row("createdAt")?.textContent).toContain("2026");
    expect(row("createdAt")?.textContent).not.toContain("T00:00");
    expect(row("updatedAt")).not.toBeNull();
    void expanded;
  });

  it("stands the preset rows and the custom rows over the record", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("description", "The stand");
        d.setAttribute("tags", ["a", "b"]);
        d.setAttribute("createdBy", { id: "u1" });
        d.setAttribute("status", "draft");
        d.setAttribute("publishedAt", "2026-11-01T00:00:00.000Z");
        d.setAttribute("cover", "file-1");
        d.setAttribute("custom", "custom-value");
      },
    });
    const expanded = expand();
    for (const key of ["description", "tags", "createdBy", "cover", "status", "publishedAt", "custom"]) {
      expect(row(key), `the row of "${key}" should stand`).not.toBeNull();
    }
    expect(row("description")?.textContent).toContain("The stand");
    expect(row("tags")?.textContent).toContain("a");
    expect(row("tags")?.textContent).toContain("b");
    // The createdBy's id-only stand (the display is the id — the consumer's
    // resolution stands the name over its `renderAttribute`).
    expect(row("createdBy")?.textContent).toContain("u1");
    // The createdBy's row stands display-only (no remove button's stand).
    expect(row("createdBy")?.querySelector('[data-slot="docblocks/attribute-row-remove"]')).toBeNull();
    // The status's row stands display-only (the consumer's data — the
    // panel's editor / the remove button stand absent over the edit mode).
    expect(row("status")?.textContent).toContain("draft");
    expect(row("status")?.querySelector('[data-slot="docblocks/attributes-status"]')).toBeNull();
    expect(row("status")?.querySelector('[data-slot="docblocks/attribute-row-remove"]')).toBeNull();
    expect(row("custom")?.textContent).toContain("custom-value");
    void expanded;
    void doc;
  });

  it("the legacy mention reference's label stands ignored over the display (the id's stand)", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("createdBy", { id: "u1", label: "Alice" });
        d.setAttribute("owner", { type: "mention", value: { id: "u9" } });
        d.setAttribute("team", { type: "list", value: ["x", "y"] });
      },
    });
    expand();
    // The legacy's label is preserved over the data, but the display stands
    // the id (the consumer's resolution's stand).
    expect(doc.meta.attributes?.createdBy).toEqual({ id: "u1", label: "Alice" });
    expect(row("createdBy")?.textContent).toContain("u1");
    expect(row("createdBy")?.textContent).not.toContain("Alice");
    // The typed's mention stands its id over the display.
    expect(row("owner")?.textContent).toContain("u9");
    // The typed's list stands the joined display.
    expect(row("team")?.textContent).toContain("x, y");
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

  it("the add's flow: the popover's type pick + the name's commit (the typed value's initial form; the list's replenish, the button's tail stand)", () => {
    const doc = renderEditor();
    expand();
    const addButton = (): HTMLElement => {
      const button = document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-button"]');
      expect(button, "the add's button should stand").not.toBeNull();
      return button!;
    };
    const openAdd = (): void => {
      fireEvent.click(addButton());
      expect(
        document.querySelector('[data-slot="docblocks/attributes-add-key"]'),
        "the popover should stand"
      ).not.toBeNull();
    };
    const typeOption = (type: string): HTMLElement =>
      document.querySelector<HTMLElement>(`[data-slot="docblocks/attributes-add-type"] [data-type="${type}"]`)!;
    const keyInput = (): HTMLInputElement =>
      document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-add-key"]')!;
    const confirm = (): void => {
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-confirm"]')!);
    };

    // The default type (string) over the name's commit: the typed wrapper's
    // initial form (the value's edit stands the row's own zone).
    openAdd();
    // The name's placeholder (not the key's stand) + the confirm's
    // disabled stand over the empty draft.
    expect(keyInput().placeholder).toBe("Name");
    expect(
      (document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-confirm"]') as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.change(keyInput(), { target: { value: "note" } });
    expect(
      (document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-confirm"]') as HTMLButtonElement)
        .disabled
    ).toBe(false);
    confirm();
    expect(doc.meta.attributes?.note).toEqual({ type: "string", value: "" });
    // The popover's close, the row's addition, the button's tail stand.
    expect(document.querySelector('[data-slot="docblocks/attributes-add-key"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/attributes-add-button"]')).not.toBeNull();

    // The number / the boolean / the list's initial forms.
    openAdd();
    fireEvent.click(typeOption("number"));
    fireEvent.change(keyInput(), { target: { value: "count" } });
    confirm();
    expect(doc.meta.attributes?.count).toEqual({ type: "number", value: 0 });

    openAdd();
    fireEvent.click(typeOption("boolean"));
    fireEvent.change(keyInput(), { target: { value: "flag" } });
    confirm();
    expect(doc.meta.attributes?.flag).toEqual({ type: "boolean", value: false });

    openAdd();
    fireEvent.click(typeOption("list"));
    fireEvent.change(keyInput(), { target: { value: "team" } });
    confirm();
    expect(doc.meta.attributes?.team).toEqual({ type: "list", value: [] });

    // The mention's stand (the name stands the target's id — the id-only
    // reference; the key stands the id — the one-reference-per-key stand).
    openAdd();
    fireEvent.click(typeOption("mention"));
    fireEvent.change(keyInput(), { target: { value: "u7" } });
    confirm();
    expect(doc.meta.attributes?.u7).toEqual({ type: "mention", value: { id: "u7" } });

    // The empty name's no-op stand (no write, the popover's open stand).
    openAdd();
    confirm();
    expect(doc.meta.attributes).not.toHaveProperty("nokey");
    expect(document.querySelector('[data-slot="docblocks/attributes-add-key"]')).not.toBeNull();

    // The reserved key: the core's rejection stands the popover's inline
    // error (no write, the doc's stand unchanged, the popover's open stand).
    fireEvent.change(keyInput(), { target: { value: "title" } });
    confirm();
    expect(doc.meta.title).toBe("T"); // the meta's title stands untouched
    expect(doc.meta.attributes?.title).toBeUndefined();
    expect(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-error"]')?.textContent).toContain(
      "reserved"
    );
  });

  it("the typed value's edit stands over the row's zone (the write-back's forms: the number / the list / the mention / the boolean's toggle; the invalid number's no-write)", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("count", { type: "number", value: 3 });
        d.setAttribute("items", { type: "list", value: ["alpha", "beta"] });
        d.setAttribute("owner", { type: "mention", value: { id: "u7" } });
        d.setAttribute("flag", { type: "boolean", value: false });
      },
    });
    expand();
    const customButton = (key: string): HTMLElement =>
      document.querySelector<HTMLElement>(`[data-slot="docblocks/attribute-custom"][data-attribute-key="${key}"]`)!;
    const editInput = (key: string): HTMLInputElement =>
      document.querySelector<HTMLInputElement>(`[data-slot="docblocks/attribute-${key}-edit"]`)!;
    const commitEdit = (key: string, value: string): void => {
      fireEvent.click(customButton(key));
      fireEvent.change(editInput(key), { target: { value } });
      fireEvent.keyDown(editInput(key), { key: "Enter" });
    };

    // The number: the typed form's write-back (the value's stand over the
    // type's keep).
    commitEdit("count", "12");
    expect(doc.meta.attributes?.count).toEqual({ type: "number", value: 12 });
    // The invalid number's stand (no write — the old value's keep, the
    // edit's close).
    commitEdit("count", "not-a-number");
    expect(doc.meta.attributes?.count).toEqual({ type: "number", value: 12 });
    expect(editInput("count")).toBeNull();

    // The list: the comma's parse (the trimmed items' stand).
    commitEdit("items", "gamma, delta ");
    expect(doc.meta.attributes?.items).toEqual({ type: "list", value: ["gamma", "delta"] });

    // The mention: the id's write-back (the typed form's keep).
    commitEdit("owner", "u9");
    expect(doc.meta.attributes?.owner).toEqual({ type: "mention", value: { id: "u9" } });

    // The boolean: the click's toggle (the value's flip — one write).
    fireEvent.click(customButton("flag"));
    expect(doc.meta.attributes?.flag).toEqual({ type: "boolean", value: true });

    // The empty's stand (the value's removal over the custom row too).
    commitEdit("count", "");
    expect(doc.meta.attributes).not.toHaveProperty("count");
  });
});

describe("the custom rows' display order + the drag's affordance", () => {
  it("stands the custom rows over the stored order (not the record's key order), the record's key order over the field's absence", () => {
    const doc = renderEditor({
      prepare: (d) => {
        // The record's keys stand alphabetical (zeta, mid, alpha); the
        // stored order stands the user's drag's stand.
        d.setAttribute("zeta", 1);
        d.setAttribute("mid", 2);
        d.setAttribute("alpha", 3);
        d.reorderAttributes(["zeta", "mid", "alpha"]); // the record's stand (the field's creation)
        d.reorderAttributes(["mid", "alpha", "zeta"]);
      },
    });
    expand();
    const custom = document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-custom"]');
    expect(custom).not.toBeNull();
    const keys = Array.from(custom!.querySelectorAll('[data-slot="docblocks/attribute-row"]')).map((el) =>
      el.getAttribute("data-attribute-key")
    );
    expect(keys).toEqual(["mid", "alpha", "zeta"]);
    void doc;
  });

  it("stands the record's key order over the field's absence (the reader's fallback)", () => {
    // The legacy stand: a loaded doc over the `attributesOrder`'s absence
    // (the field's drop — the new writer maintains it over every write).
    const legacy = fromJSON({
      v: 1,
      id: "doc-1",
      title: "T",
      createdAt: CREATED_AT,
      blocks: { "doc-1": { type: "root", children: [] } },
      attributes: { zeta: 1, mid: 2, alpha: 3 },
    } as DocJSON);
    renderEditor({ doc: legacy });
    expand();
    const custom = document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-custom"]');
    expect(custom).not.toBeNull();
    const keys = Array.from(custom!.querySelectorAll('[data-slot="docblocks/attribute-row"]')).map((el) =>
      el.getAttribute("data-attribute-key")
    );
    // The read's sorted record order (the legacy stand — no stored order).
    expect(keys).toEqual(["alpha", "mid", "zeta"]);
  });

  it("the grip stands over the custom rows only (the preset's rows stand their fixed order), the hover's reveal, the read-only's absence", () => {
    renderEditor({
      prepare: (d) => {
        d.setAttribute("description", "d");
        d.setAttribute("alpha", 1);
        d.setAttribute("beta", 2);
      },
    });
    expand();
    const grip = (key: string) =>
      document.querySelector<HTMLElement>(`[data-slot="docblocks/attribute-row-grip"][data-attribute-key="${key}"]`);
    // The grip stands over every custom row (the edit mode), not over the
    // preset's rows (the fixed order's stand).
    expect(grip("alpha")).not.toBeNull();
    expect(grip("beta")).not.toBeNull();
    expect(grip("description")).toBeNull();
    // The grip's accessible name (the reorder's stand over the key).
    expect(grip("alpha")?.getAttribute("aria-label")).toBe("Reorder alpha");
  });

  it("the read-only stand (the view mode) renders no grip and no drag group", () => {
    renderEditor({
      mode: "view",
      prepare: (d) => {
        d.setAttribute("alpha", 1);
        d.setAttribute("beta", 2);
      },
    });
    expand();
    expect(document.querySelector('[data-slot="docblocks/attribute-row-grip"]')).toBeNull();
    // The rows still stand (the display-only's parity).
    expect(row("alpha")).not.toBeNull();
    expect(row("beta")).not.toBeNull();
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

  it("renderAttribute replaces the row's value zone over the key (the null's stand the built-in; the consumer's commit stands the doc's write)", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("description", "built-in");
        d.setAttribute("status", "draft");
      },
      renderAttribute: ({ key, value, onChange, readOnly }) =>
        key === "status" ? (
          <span data-testid="consumer-status">
            consumer: {String(value ?? "")} ({String(readOnly)})
            <button data-testid="consumer-set" onClick={() => onChange("published")}>
              set
            </button>
          </span>
        ) : null,
    });
    expand();
    // The consumer's zone stands over the named key (the built-in's stand
    // over the consumer's `null` / the absent key).
    expect(document.querySelector('[data-testid="consumer-status"]')?.textContent).toContain("consumer: draft");
    expect(row("description")?.textContent).toContain("built-in");
    // The consumer's commit entry stands the doc's write (one setAttribute).
    const consumerBtn = document.querySelector<HTMLElement>("[data-testid='consumer-set']");
    expect(consumerBtn).not.toBeNull();
    fireEvent.click(consumerBtn!);
    expect(doc.meta.attributes?.status).toBe("published");
  });

  it("attributeTypePicker replaces the built-in type picker over the add flow", () => {
    const doc = renderEditor({
      attributeTypePicker: ({ value, onChange }) => (
        <button data-testid="consumer-type-picker" onClick={() => onChange("number")}>
          custom picker ({String(value)})
        </button>
      ),
    });
    expand();
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-button"]')!);
    // The built-in's options stand off; the consumer's picker stands.
    expect(document.querySelector('[data-slot="docblocks/attributes-add-type-option"]')).toBeNull();
    const picker = document.querySelector<HTMLElement>("[data-testid='consumer-type-picker']");
    expect(picker).not.toBeNull();
    // The pick stands the type's commit over the name's commit.
    fireEvent.click(picker!);
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-add-key"]')!, {
      target: { value: "count" },
    });
    fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-add-confirm"]')!);
    expect(doc.meta.attributes?.count).toEqual({ type: "number", value: 0 });
  });
});
