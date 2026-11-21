// @vitest-environment jsdom
// The document-attributes panel's edit commits: the description's inline
// edit (the Enter / the blur / the Escape), the custom row's removal, the
// add's flow (the popover's type pick + the name's commit), and the typed
// value's write-back over the row's zone.
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expand, renderEditor, row } from "./attributes-panel.helpers";

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
