// @vitest-environment jsdom
// The document-attributes panel: the page column's
// above-the-first-block stand (collapsed by default, the session state),
// the rows (the system / the preset / the custom), the edit commits, the
// read-only's display-only stand, `hiddenAttributes`, and the canvas
// view's absence.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc, fromJSON } from "docblocks-core";
import type { AttributeType, Doc, DocJSON } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import type { DocDescription, DocTags, RenderAttributeProps } from "../src/editor-provider";

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
  docTags?: DocTags;
  docDescription?: DocDescription;
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
      docTags={options.docTags}
      docDescription={options.docDescription}
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
    // The tags' consumer-owned stand: over the prop's absence the row stands
    // the placeholder (the stored `attributes.tags`'s data stands inert —
    // the document never displays the tags over its record).
    expect(row("tags")?.textContent).toContain("Not set");
    expect(row("tags")?.querySelector('[data-slot="docblocks/attributes-tag"]')).toBeNull();
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
    // The typed's list stands the vertical's line editor (the lines' inputs
    // over the edit mode — the comma's joined display's stand dropped).
    const teamLines = Array.from(
      row("team")?.querySelectorAll<HTMLInputElement>('[data-slot="docblocks/attribute-team-list-line"]') ?? []
    ).map((el) => el.value);
    expect(teamLines).toEqual(["x", "y"]);
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

  describe("the tags' consumer contract (the docTags' prop — the document's no-write's stand)", () => {
    const DEMO = [
      { id: "t-a", label: "alpha" },
      { id: "t-b", label: "beta" },
    ];

    it("without the prop stands the notSet's display (the document's stored tags' inert stand)", () => {
      renderEditor({ prepare: (d) => d.setAttribute("tags", ["stored"]) });
      expand();
      const tagsRow = row("tags")!;
      expect(tagsRow, "the tags' row should stand over the preset's stand").not.toBeNull();
      expect(tagsRow.textContent).toContain("Not set"); // the stored stand's inert's display
      expect(document.querySelector('[data-slot="docblocks/attributes-tag"]')).toBeNull();
      expect(document.querySelector('[data-slot="docblocks/attributes-tag-add"]')).toBeNull();
    });

    it("with the prop stands the chips over the passed list (the no-affordance over the absent callbacks)", () => {
      renderEditor({ docTags: { tags: DEMO } });
      expand();
      const chips = document.querySelectorAll<HTMLElement>('[data-slot="docblocks/attributes-tag"]');
      expect(chips).toHaveLength(2);
      expect(chips[0]!.textContent).toBe("alpha");
      expect(chips[1]!.textContent).toBe("beta");
      // The absent onTagAdd / onTagRemove's stands: the affordances absent.
      expect(document.querySelector('[data-slot="docblocks/attributes-tag-add"]')).toBeNull();
      expect(document.querySelector('[data-slot="docblocks/attributes-tag-remove"]')).toBeNull();
      // The document's no-write's stand: the record stands untouched.
      expect(document.querySelector('[data-slot="docblocks/attributes-tags"]')).not.toBeNull();
    });

    it("the onTagRemove's click over the chip's x (the tag's identity; the chip's click's no-stand)", () => {
      const onTagRemove = vi.fn();
      const onTagClick = vi.fn();
      renderEditor({ docTags: { tags: DEMO, onTagRemove, onTagClick } });
      expand();
      const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-tag"][data-tag-id="t-a"]')!;
      fireEvent.click(chip.querySelector<HTMLElement>("[data-slot='docblocks/attributes-tag-remove']")!);
      expect(onTagRemove).toHaveBeenCalledTimes(1);
      expect(onTagRemove).toHaveBeenCalledWith({ id: "t-a", label: "alpha" });
      expect(onTagClick).not.toHaveBeenCalled(); // the stopPropagation's stand

      // The chip's click (the chip's body): the native event's stand
      // (the consumer's navigation's stand — the package opens nothing).
      fireEvent.click(chip);
      expect(onTagClick).toHaveBeenCalledTimes(1);
      const [tag, event] = onTagClick.mock.calls[0]!;
      expect(tag).toEqual({ id: "t-a", label: "alpha" });
      expect(event).toBeInstanceOf(MouseEvent);
    });

    it("the onTagAdd's click (the empty list's stand + the non-empty list's tail)", () => {
      const onTagAdd = vi.fn();
      renderEditor({ docTags: { tags: [], onTagAdd } });
      expand();
      // The empty list's stand: the affordance stands alone (the no chips).
      expect(document.querySelectorAll('[data-slot="docblocks/attributes-tag"]').length).toBe(0);
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-tag-add"]')!);
      expect(onTagAdd).toHaveBeenCalledTimes(1);

      cleanup();
      renderEditor({ docTags: { tags: DEMO, onTagAdd } });
      expand();
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-tag-add"]')!);
      expect(onTagAdd).toHaveBeenCalledTimes(2); // the shared mock's stand over the both renders
    });

    it("the empty list over the absent onTagAdd stands the placeholder (the display-only's stand)", () => {
      renderEditor({ docTags: { tags: [] } });
      expand();
      const tagsRow = row("tags")!;
      expect(tagsRow.textContent).toContain("Not set");
      expect(document.querySelector('[data-slot="docblocks/attributes-tag-add"]')).toBeNull();
    });

    it("the read-only's stand: the no add / no removal, the chip's click's stand", () => {
      const onTagClick = vi.fn();
      renderEditor({
        mode: "view",
        docTags: { tags: DEMO, onTagAdd: vi.fn(), onTagRemove: vi.fn(), onTagClick },
      });
      expand();
      expect(document.querySelector('[data-slot="docblocks/attributes-tag-add"]')).toBeNull();
      expect(document.querySelector('[data-slot="docblocks/attributes-tag-remove"]')).toBeNull();
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-tag"]')!);
      expect(onTagClick).toHaveBeenCalledTimes(1); // the observing gesture's parity
    });

    it("the hiddenAttributes' tags' hide (the prop's stand kept)", () => {
      renderEditor({ hiddenAttributes: ["tags"], docTags: { tags: DEMO } });
      expand();
      expect(row("tags")).toBeNull();
    });
  });

  describe("the description's consumer contract (the docDescription's prop — the document's no-write's stand)", () => {
    it("without the prop stands the built-in's stand (the value over the doc's record; the edit's doc commit)", () => {
      const doc = renderEditor({ prepare: (d) => d.setAttribute("description", "old") });
      expand();
      expect(row("description")?.textContent).toContain("old");
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-description"]')!);
      const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-description-edit"]')!;
      fireEvent.change(input, { target: { value: "new" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(doc.meta.attributes?.description).toBe("new");
    });

    it("with the prop stands the value over the passed read (the doc's stored stand's inert's display)", () => {
      const doc = renderEditor({
        prepare: (d) => d.setAttribute("description", "stored"),
        docDescription: { value: "The consumer's description" },
      });
      expand();
      expect(row("description")?.textContent).toContain("The consumer's description");
      expect(row("description")?.textContent).not.toContain("stored");
      // The absent onEdit's display-only's stand: the click stands no edit's
      // entry (the display's stand), the doc's record stands untouched.
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-description"]')!);
      expect(document.querySelector('[data-slot="docblocks/attributes-description-edit"]')).toBeNull();
      expect(doc.meta.attributes?.description).toBe("stored");
    });

    it("the onEdit's commit over the inline editor's Enter (the entered string's verbatim; the doc's no-write's stand)", () => {
      const onEdit = vi.fn();
      const doc = renderEditor({ docDescription: { value: "old", onEdit } });
      expand();
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-description"]')!);
      const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-description-edit"]')!;
      fireEvent.change(input, { target: { value: "new" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit).toHaveBeenCalledWith("new");
      // The document's no-write's stand: the record stands no `description`.
      expect(doc.meta.attributes).toBeUndefined();
    });

    it("the Escape cancels without the onEdit's call (the value stands the prop's stand)", () => {
      const onEdit = vi.fn();
      renderEditor({ docDescription: { value: "old", onEdit } });
      expand();
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-description"]')!);
      const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/attributes-description-edit"]')!;
      fireEvent.change(input, { target: { value: "cancelled" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("the row's remove affordance stands the onEdit's empty commit (the removal's stand)", () => {
      const onEdit = vi.fn();
      renderEditor({ docDescription: { value: "old", onEdit } });
      expand();
      const removeButton = row("description")?.querySelector('[data-slot="docblocks/attribute-row-remove"]');
      expect(removeButton, "the remove's affordance should stand over the non-empty's value").not.toBeNull();
      fireEvent.click(removeButton!);
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit).toHaveBeenCalledWith("");
    });

    it("the absent onEdit stands the display-only's stand (the no remove's affordance over the edit mode)", () => {
      renderEditor({ docDescription: { value: "old" } });
      expand();
      expect(row("description")?.querySelector('[data-slot="docblocks/attribute-row-remove"]')).toBeNull();
    });

    it("the null value stands the notSet's placeholder (the no remove's affordance)", () => {
      renderEditor({ docDescription: { value: null, onEdit: vi.fn() } });
      expand();
      expect(row("description")?.textContent).toContain("Not set");
      expect(row("description")?.querySelector('[data-slot="docblocks/attribute-row-remove"]')).toBeNull();
    });

    it("the read-only's stand: the value over the prop's read, the no edit's entry (the display-only's parity)", () => {
      const onEdit = vi.fn();
      renderEditor({ mode: "view", docDescription: { value: "The consumer's description", onEdit } });
      expand();
      expect(row("description")?.textContent).toContain("The consumer's description");
      fireEvent.click(document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-description"]')!);
      expect(document.querySelector('[data-slot="docblocks/attributes-description-edit"]')).toBeNull();
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("the renderAttribute's out-of-reach over the prop's presence (the consumer's zone stands absent)", () => {
      const renderAttribute = vi.fn(() => <span data-testid="consumer-zone">consumer</span>);
      renderEditor({ docDescription: { value: "The consumer's description" }, renderAttribute });
      expand();
      expect(row("description")?.textContent).toContain("The consumer's description");
      expect(row("description")?.querySelector('[data-testid="consumer-zone"]')).toBeNull();
    });

    it("the hiddenAttributes' description's hide (the prop's stand kept)", () => {
      renderEditor({ hiddenAttributes: ["description"], docDescription: { value: "The consumer's description" } });
      expand();
      expect(row("description")).toBeNull();
    });
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

    // The list: the vertical's line editor (the lines' inputs + the new
    // line's input over the stack's tail — the typed form's keep).
    const listSlot = '[data-slot="docblocks/attribute-items-list"]';
    const listLines = (): HTMLInputElement[] =>
      Array.from(
        document.querySelectorAll<HTMLInputElement>(`${listSlot} [data-slot="docblocks/attribute-items-list-line"]`)
      );
    expect(listLines().map((el) => el.value)).toEqual(["alpha", "beta"]);
    // The new line's add (the Enter's commit over the tail's input).
    const listAdd = document.querySelector<HTMLInputElement>(
      `${listSlot} [data-slot="docblocks/attribute-items-list-input"]`
    )!;
    fireEvent.change(listAdd, { target: { value: "gamma" } });
    fireEvent.keyDown(listAdd, { key: "Enter" });
    expect(doc.meta.attributes?.items).toEqual({ type: "list", value: ["alpha", "beta", "gamma"] });
    expect(listLines().map((el) => el.value)).toEqual(["alpha", "beta", "gamma"]);
    // The line's removal (the × over the line's right — the whole list's
    // commit).
    const firstRemove = document.querySelector<HTMLElement>(
      `${listSlot} [data-slot="docblocks/attribute-items-list-line-remove"]`
    )!;
    fireEvent.click(firstRemove);
    expect(doc.meta.attributes?.items).toEqual({ type: "list", value: ["beta", "gamma"] });
    // The line's edit's commit (the Enter over the line's input — the
    // typed form's keep).
    const betaLine = listLines()[0]!;
    fireEvent.change(betaLine, { target: { value: "beta2" } });
    fireEvent.keyDown(betaLine, { key: "Enter" });
    expect(doc.meta.attributes?.items).toEqual({ type: "list", value: ["beta2", "gamma"] });

    // The mention: the id's write-back (the typed form's keep).
    commitEdit("owner", "u9");
    expect(doc.meta.attributes?.owner).toEqual({ type: "mention", value: { id: "u9" } });

    // The boolean: the project's checkbox's toggle (the value's flip —
    // one write, the typed form's keep).
    const flagCheckbox = () =>
      document.querySelector<HTMLElement>(
        '[data-slot="docblocks/attribute-custom-boolean"][data-attribute-key="flag"]'
      )!;
    expect(flagCheckbox().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(flagCheckbox());
    expect(doc.meta.attributes?.flag).toEqual({ type: "boolean", value: true });
    expect(flagCheckbox().getAttribute("aria-checked")).toBe("true");

    // The plain boolean's stand (the untyped form's parity — the checkbox
    // over it too, the plain write-back's keep).
    act(() => {
      doc.setAttribute("plain", true);
    });
    const plainCheckbox = () =>
      document.querySelector<HTMLElement>(
        '[data-slot="docblocks/attribute-custom-boolean"][data-attribute-key="plain"]'
      )!;
    expect(plainCheckbox().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(plainCheckbox());
    expect(doc.meta.attributes?.plain).toBe(false);

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
        d.setAttribute("lst", ["a", "b"]);
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
    // The top align's stand: the list's row's grip stands the first
    // line's midline (the `top-1.5` over the band's `mt-0.5` + the
    // `py-1`'s center), the single value's rows stand the row's center
    // (the `top-1/2`).
    expect(grip("lst")?.className).toContain("top-1.5");
    expect(grip("lst")?.className).not.toContain("top-1/2");
    expect(grip("alpha")?.className).toContain("top-1/2");
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

describe("the key's rename over the key's click", () => {
  const keyButton = (key: string): HTMLElement =>
    document.querySelector<HTMLElement>(`[data-slot="docblocks/attribute-key"][data-attribute-key="${key}"]`)!;
  const renameInput = (key: string): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(`[data-slot="docblocks/attribute-${key}-rename"]`)!;

  it("renames the key over the value's form keep (the typed wrapper's parity — the click's entry, the select-all's stand)", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("note", { type: "string", value: "hello" });
        d.setAttribute("count", { type: "number", value: 3 });
      },
    });
    expand();
    // The key's entry (the custom row's rename button — the display's
    // click stand).
    const entry = keyButton("note");
    expect(entry, "the custom row's key entry should stand").not.toBeNull();
    expect(entry.textContent).toBe("note");
    act(() => {
      fireEvent.click(entry);
    });
    const input = renameInput("note");
    expect(input).not.toBeNull();
    expect(input.value).toBe("note");
    // The select-all's stand (the rename's replace: the value's whole
    // selection — the first keystroke replaces it).
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    // The frame's stand (the text's edge's keep, the frame's left
    // stand over the text — the no-glue's parity).
    expect(input.className).toContain("-ml-1.5");
    expect(input.className).toContain("pl-1.5");
    expect(input.className).toContain("h-7");
    // The key's band's stand (the value's band's parity — the height's
    // keep over the click, the text's inset over the glyphs).
    expect(entry.className).toContain("py-1");
    expect(entry.className).toContain("px-1.5");
    expect(entry.className).toContain("-ml-1.5");
    // The rename's commit over the Enter (the whole input's replace).
    act(() => {
      fireEvent.change(input, { target: { value: "remark" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(doc.meta.attributes?.note).toBeUndefined();
    expect(doc.meta.attributes?.remark).toEqual({ type: "string", value: "hello" });
    expect(row("note")).toBeNull();
    expect(row("remark")).not.toBeNull();
    // The count's form stands untouched (the rename's key-only stand).
    expect(doc.meta.attributes?.count).toEqual({ type: "number", value: 3 });
  });

  it("keeps the display order's position over the rename (the entry's replacement)", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("a", 1);
        d.setAttribute("b", 2);
        d.reorderAttributes(["b", "a"]);
      },
    });
    expand();
    act(() => {
      fireEvent.click(keyButton("b"));
    });
    const input = renameInput("b");
    act(() => {
      fireEvent.change(input, { target: { value: "z" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(doc.meta.attributesOrder).toEqual(["z", "a"]);
    expect(doc.meta.attributes).toEqual({ a: 1, z: 2 });
  });

  it("rejects the reserved / the taken target (the no-write stand, the input's open stand over the invalid's border)", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("a", 1);
        d.setAttribute("b", 2);
      },
    });
    expand();
    // The reserved's target (the doc meta's field's collision).
    act(() => {
      fireEvent.click(keyButton("a"));
    });
    const input = renameInput("a");
    act(() => {
      fireEvent.change(input, { target: { value: "title" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(doc.meta.attributes).toEqual({ a: 1, b: 2 });
    // The input's open stand over the invalid's border (the re-type's
    // stand — the commit's typed error's keep).
    expect(renameInput("a"), "the input should stay open over the invalid target").not.toBeNull();
    expect(renameInput("a").getAttribute("aria-invalid")).toBe("true");
    // The taken's target (the existing key's collision).
    act(() => {
      fireEvent.change(renameInput("a"), { target: { value: "b" } });
      fireEvent.keyDown(renameInput("a"), { key: "Enter" });
    });
    expect(doc.meta.attributes).toEqual({ a: 1, b: 2 });
    expect(renameInput("a").getAttribute("aria-invalid")).toBe("true");
    // The valid target's recovery (the re-type's commit's stand).
    act(() => {
      fireEvent.change(renameInput("a"), { target: { value: "c" } });
      fireEvent.keyDown(renameInput("a"), { key: "Enter" });
    });
    expect(doc.meta.attributes).toEqual({ c: 1, b: 2 });
    expect(renameInput("a"), "the input should close over the valid commit").toBeNull();
  });

  it("cancels over the Escape / the empty's commit (the no-write stand)", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("a", 1);
      },
    });
    expand();
    // The Escape's cancel (the input's close, the value's keep).
    act(() => {
      fireEvent.click(keyButton("a"));
    });
    const input = renameInput("a");
    act(() => {
      fireEvent.change(input, { target: { value: "zzz" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(renameInput("a")).toBeNull();
    expect(doc.meta.attributes).toEqual({ a: 1 });
    // The empty's commit's cancel (the key is required — the remove's
    // button stands the removal, not the rename to the empty).
    act(() => {
      fireEvent.click(keyButton("a"));
    });
    const input2 = renameInput("a");
    act(() => {
      fireEvent.change(input2, { target: { value: "   " } });
      fireEvent.keyDown(input2, { key: "Enter" });
    });
    expect(renameInput("a")).toBeNull();
    expect(doc.meta.attributes).toEqual({ a: 1 });
  });

  it("the same key's commit is the no-op stand (the input's close, the no-write)", () => {
    const doc = renderEditor({
      prepare: (d) => {
        d.setAttribute("a", 1);
      },
    });
    expand();
    act(() => {
      fireEvent.click(keyButton("a"));
    });
    const input = renameInput("a");
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(renameInput("a")).toBeNull();
    expect(doc.meta.attributes).toEqual({ a: 1 });
  });

  it("the preset / the system rows stand no rename entry (the fixed vocabulary's stand)", () => {
    renderEditor({
      prepare: (d) => {
        d.setAttribute("description", "d");
        d.setAttribute("custom", "v");
      },
    });
    expand();
    // The preset's key (the fixed vocabulary's stand — the display only).
    expect(
      document.querySelector('[data-slot="docblocks/attribute-key"][data-attribute-key="description"]')
    ).toBeNull();
    // The system's keys (the id / the dates' read-only stand — the display
    // only).
    expect(row("id")?.querySelector('[data-slot="docblocks/attribute-key"]')).toBeNull();
    // The custom's key stands the entry (the parity).
    expect(document.querySelector('[data-slot="docblocks/attribute-key"][data-attribute-key="custom"]')).not.toBeNull();
  });

  it("the read-only's rows stand no rename entry (the display-only's parity)", () => {
    renderEditor({
      mode: "view",
      prepare: (d) => {
        d.setAttribute("custom", "v");
      },
    });
    expand();
    expect(document.querySelector('[data-slot="docblocks/attribute-key"]')).toBeNull();
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
        d.setAttribute("lines", { type: "list", value: ["one", "two"] });
        d.setAttribute("flag", { type: "boolean", value: true });
      },
    });
    const expanded = expand();
    // No edit entry: the display's stand (no inputs, no remove buttons,
    // no the add row's stand; the tags' consumer affordances absent over
    // the no-prop's stand).
    expect(document.querySelector('[data-slot="docblocks/attributes-tag-add"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/attributes-tag-remove"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/attributes-add"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/attribute-row-remove"]')).toBeNull();
    expect(row("description")?.textContent).toContain("d");
    expect(row("custom")?.textContent).toContain("v");
    // The list's read-only stand: the stacked lines' display (no inputs,
    // no the line's removal's buttons).
    const listDisplay = document.querySelector('[data-slot="docblocks/attribute-lines-list"]');
    expect(listDisplay).not.toBeNull();
    expect(listDisplay?.querySelectorAll('[data-slot="docblocks/attribute-lines-list-item"]').length ?? 0).toBe(2);
    expect(listDisplay?.querySelector("input")).toBeNull();
    expect(listDisplay?.querySelector('[data-slot="docblocks/attribute-lines-list-line-remove"]')).toBeNull();
    // The boolean's checkbox stands the read-only's disabled stand (the
    // value's display over the checked, the toggle's off).
    const flagCheckbox = document.querySelector<HTMLElement>(
      '[data-slot="docblocks/attribute-custom-boolean"][data-attribute-key="flag"]'
    );
    expect(flagCheckbox).not.toBeNull();
    expect(flagCheckbox!.hasAttribute("disabled")).toBe(true);
    expect(flagCheckbox!.getAttribute("aria-checked")).toBe("true");
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
