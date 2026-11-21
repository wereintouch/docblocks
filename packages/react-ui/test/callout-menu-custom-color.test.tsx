// @vitest-environment jsdom
// The callout's custom color (the rainbow's swatch + the hex's input — the
// shared's mechanism): the hex's field's commit (the Enter / the blur's
// write + the menu's close), the invalid draft's stands (the no-write, the
// close's reset), the custom swatch's press's caret seat, and the dot over
// the non-preset value.
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { calloutAttrsOf, iconButtonOf, menuOf, renderDoc } from "./callout-menu.helpers";

describe("the callout's custom color (the rainbow's swatch + the hex's input — the shared's mechanism)", () => {
  /** Open the menu; returns the hex's input (the section stands always). */
  function openMenu(): HTMLInputElement {
    act(() => {
      fireEvent.click(iconButtonOf());
    });
    const custom = menuOf().querySelector('[data-slot="docblocks/palette-custom"]');
    expect(custom, "the custom swatch should stand").not.toBeNull();
    const field = document.querySelector<HTMLInputElement>('input[data-slot="docblocks/callout-color-picker"]');
    expect(field, "the hex's input should stand (the always-visible section)").not.toBeNull();
    return field!;
  }

  it("commits the hex field's valid Enter (one write, the menu's close)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const field = openMenu();
    act(() => {
      fireEvent.change(field, { target: { value: "#1A2B3C" } });
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(calloutAttrsOf(doc, co)?.color).toBe("#1a2b3c");
    // The apply stands the menu's close.
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("commits the hex's valid blur (the write + the menu's close)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const field = openMenu();
    act(() => {
      fireEvent.change(field, { target: { value: "#336699" } });
      fireEvent.blur(field);
    });
    expect(calloutAttrsOf(doc, co)?.color).toBe("#336699");
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("ignores the invalid draft (no write, the menu's stand, the text's keep)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const field = openMenu();
    const before = doc.encode();
    act(() => {
      fireEvent.change(field, { target: { value: "#gg" } });
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(doc.encode()).toStrictEqual(before);
    expect(calloutAttrsOf(doc, co)?.color ?? null).toBe(null);
    // The invalid draft stands (the input's text, the retry's parity).
    expect(field.value).toBe("#gg");
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).not.toBeNull();
  });

  it("writes nothing for the close over the invalid draft (the draft's reset)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const field = openMenu();
    const before = doc.encode();
    act(() => {
      fireEvent.change(field, { target: { value: "#12" } });
      fireEvent.keyDown(menuOf(), { key: "Escape" });
    });
    expect(doc.encode()).toStrictEqual(before);
    expect(calloutAttrsOf(doc, co)?.color ?? null).toBe(null);
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("seats the caret over the hex on the custom swatch's press (the focus's parity)", () => {
    renderDoc((d) => {
      d.insertBlock("callout", {});
    });
    act(() => {
      fireEvent.click(iconButtonOf());
    });
    const field = document.querySelector<HTMLInputElement>('input[data-slot="docblocks/callout-color-picker"]')!;
    const custom = menuOf().querySelector('[data-slot="docblocks/palette-custom"]');
    expect(custom).not.toBeNull();
    act(() => {
      custom!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(field);
  });

  it("carries the non-preset value over the custom swatch's dot (the hex's commit's stand)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const field = openMenu();
    act(() => {
      fireEvent.change(field, { target: { value: "#ff5500" } });
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(calloutAttrsOf(doc, co)?.color).toBe("#ff5500");
    // Re-open the menu: the custom swatch's dot stands the non-preset's value.
    act(() => {
      fireEvent.click(iconButtonOf());
    });
    const dot = menuOf().querySelector<HTMLElement>('[data-slot="docblocks/palette-custom-current"]');
    expect(dot, "the custom swatch's dot should be over the non-preset value").not.toBeNull();
    expect(getComputedStyle(dot!).backgroundColor).toBe("rgb(255, 85, 0)");
  });
});
