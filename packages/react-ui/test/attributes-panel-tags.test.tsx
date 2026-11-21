// @vitest-environment jsdom
// The document-attributes panel: the tags' consumer contract over the
// `docTags`'s prop (the chips / the add's / the removal's events, the
// display-only's stand, the read-only's parity, the `hiddenAttributes`'s
// hide).
import { cleanup, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { expand, renderEditor, row } from "./attributes-panel.helpers";

describe("the edit commits", () => {
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
});
