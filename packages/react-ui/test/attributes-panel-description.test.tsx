// @vitest-environment jsdom
// The document-attributes panel: the description's consumer contract over
// the `docDescription`'s prop (the passed read's stand, the `onEdit`'s
// commit / the Escape's cancel, the display-only's stand, the read-only's
// parity).
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { expand, renderEditor, row } from "./attributes-panel.helpers";

describe("the edit commits", () => {
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
});
