// @vitest-environment jsdom
// The document-attributes panel: the custom rows' display order over the
// `attributesOrder`'s stand (the stored order's read, the legacy's sorted
// record order's fallback, the grip's affordance, the read-only's
// absence).
import { describe, expect, it } from "vitest";

import { fromJSON } from "docblocks-core";
import type { DocJSON } from "docblocks-core";

import { CREATED_AT, expand, renderEditor, row } from "./attributes-panel.helpers";

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
