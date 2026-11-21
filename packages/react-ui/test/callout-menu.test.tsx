// @vitest-environment jsdom
// The callout's block menu (the clickable marker-zone icon): the type
// preset and the icon catalog commit one updateBlock each (one undo step,
// one wire update). The menu stands for an empty callout (no text
// selection needed). The read-only stand renders the icon without a
// button.
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import {
  calloutAttrsOf,
  iconButtonOf,
  pressCalloutControl,
  renderDoc,
  selectRange,
  toolbarOf,
} from "./callout-menu.helpers";

describe("the callout's block menu (the marker-zone icon's button)", () => {
  it("stands the icon button, and the toolbar's callout range keeps no callout controls", () => {
    let co: BlockId = "";
    renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info" });
      d.insertText(co, 0, "note");
    });
    expect(iconButtonOf()).not.toBeNull();
    // The text range's toolbar stands the shared marks only: the callout
    // menu's trigger and the list-type menu are both absent.
    selectRange(co, 0, 4);
    const toolbar = toolbarOf();
    expect(toolbar.querySelector('[data-mark="bold"]')).not.toBeNull();
    expect(toolbar.querySelector('button[aria-label="Callout"]')).toBeNull();
    expect(toolbar.querySelector('button[aria-label="List type"]')).toBeNull();
  });

  it("switches the type (the preset: the variant + the overrides reset) in one undo step", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info", color: "#ff0000", icon: "star" });
      d.insertText(co, 0, "note");
    });
    pressCalloutControl('[data-callout-type-btn="danger"]');
    // The variant stands the new preset; the overrides are reset to null.
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "danger", color: null, icon: null });
    // One undo step for the whole switch (the inverse stands the prior stand
    // back — the overrides and the variant).
    doc.undo();
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "info", color: "#ff0000", icon: "star" });
  });

  it("picks an icon (the override stands, the variant is kept)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "danger" });
      d.insertText(co, 0, "note");
    });
    pressCalloutControl('[data-callout-icon-btn="lightbulb"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "danger", icon: "lightbulb" });
    // The variant stood (the preset identity is kept). The pick's stand:
    // the menu closes (the picker stands no hanging over the apply).
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("the type preset clears the icon override (the variant stands, the override resets)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "warning", icon: "star" });
      d.insertText(co, 0, "note");
    });
    // The current variant's re-pick stands the preset's reset (the override
    // clears — the former's "Preset" icon's row's stand).
    pressCalloutControl('[data-callout-type-btn="warning"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "warning", icon: null, color: null });
  });

  it("clears the color override with the none swatch (the variant stands)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info", color: "#ff0000" });
      d.insertText(co, 0, "note");
    });
    pressCalloutControl('[data-slot="docblocks/palette-none"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "info", color: null });
    // The pick's stand: the menu closes over the color's apply.
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("stands no write for a no-op type re-pick (the same variant, no override)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info" });
      d.insertText(co, 0, "note");
    });
    const before = doc.encode();
    pressCalloutControl('[data-callout-type-btn="info"]');
    // A no-op stand writes nothing: the wire bytes are invariant.
    expect(doc.encode()).toStrictEqual(before);
  });

  it("stands for an empty callout (no text, no selection)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
    });
    pressCalloutControl('[data-callout-type-btn="warning"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "warning" });
  });
});

describe("the callout's read-only stand (the icon's button is absent)", () => {
  it("stands the icon without a button over the view's mode (no pointer events)", () => {
    let co: BlockId = "";
    renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "warning", icon: "star" });
      d.insertText(co, 0, "note");
    }, "view");
    expect(document.querySelector('[data-slot="docblocks/callout-icon-button"]')).toBeNull();
    const icon = document.querySelector('[data-slot="docblocks/callout-icon"]');
    expect(icon, "the icon's zone should stand (the stand's render)").not.toBeNull();
    expect((icon as HTMLElement).className).toContain("pointer-events-none");
  });
});
