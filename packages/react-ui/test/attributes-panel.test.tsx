// @vitest-environment jsdom
// The document-attributes panel: the page column's placement + the
// collapse's session stand (collapsed by default), the rows (the system /
// the preset / the custom), and the consumer's props (the
// `hiddenAttributes` / the `renderAttribute` / the `attributeTypePicker`).
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { body, expand, panel, renderEditor, row } from "./attributes-panel.helpers";

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
