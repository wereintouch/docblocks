// @vitest-environment jsdom
// The document-attributes panel: the key's rename over the key's click
// (the value's form keep, the order's position's keep, the reserved / the
// taken target's rejection, the Escape / the empty's cancel, the preset /
// the system rows' fixed vocabulary, the read-only's parity).
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expand, renderEditor, row } from "./attributes-panel.helpers";

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
