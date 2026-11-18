// @vitest-environment jsdom
// The figure's themes' stand over the shapes (the render-time's transform):
// the dark theme's light fixed fill stands the darkened's value (the SVG's
// `fill` attr + the text's contrast over the effective fill — the white's
// stand), the light theme's verbatim (the fidelity's stand), the explicit
// `textColor`'s data's stand over the contrast's resolution, the flip's
// re-render (the class's stand, the no-data's stand).
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** The dark's class's stand over the documentElement (the next-themes'). */
function setDark(dark: boolean): void {
  act(() => {
    if (dark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  });
}

async function waitForDarkStore(dark: boolean): Promise<void> {
  await waitFor(() => {
    // The MutationObserver's delivery is async (the microtask's stand).
    expect(document.documentElement.classList.contains("dark")).toBe(dark);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function seedScene(doc: TestDoc): void {
  doc.transact(() => {
    const surface = doc.insertBlock("surface");
    doc.setGeometry(surface, { x: 0, y: 0, w: 800, h: 400 });
    const light = doc.insertBlock("shape", { variant: "rect", fill: "#dae8fc", text: "light" }, { parent: surface });
    doc.setGeometry(light, { x: 0, y: 0, w: 160, h: 80 });
    const dark = doc.insertBlock(
      "shape",
      { variant: "rect", fill: "#1a1a1a", text: "dark", textColor: "#ff0000" },
      { parent: surface }
    );
    doc.setGeometry(dark, { x: 200, y: 0, w: 160, h: 80 });
    const token = doc.insertBlock(
      "shape",
      { variant: "rect", fill: "var(--docblocks-palette-blue)" },
      {
        parent: surface,
      }
    );
    doc.setGeometry(token, { x: 0, y: 100, w: 120, h: 60 });
  });
}

function renderEditor() {
  const doc = createDoc({ id: "shape-themes", createdAt: CREATED_AT });
  seedScene(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  return doc;
}

/** The shape's SVG's `g`'s fill attr (the effective fill's stand). */
function fillOf(shapeEl: Element): string | null {
  return shapeEl.querySelector("g")?.getAttribute("fill") ?? null;
}

/** The shape's text's computed color (the effective contrast's stand). */
function textColorOf(shapeEl: Element): string | null {
  const div = shapeEl.querySelector('[data-slot="docblocks/shape-text"]');
  return div === null ? null : getComputedStyle(div).color;
}

afterEach(() => {
  setDark(false);
  cleanup();
});

describe("the figure's themes' stand (the render-time's fill / text's transform)", () => {
  it("the light theme stands the fixed fill verbatim (the fidelity's stand) + the black's text over the light fill", async () => {
    setDark(false);
    await waitForDarkStore(false);
    renderEditor();

    // The `#dae8fc`'s shape (the text's "light").
    const lightShape = screen.getByText("light").closest('[data-slot="docblocks/canvas-item"]');
    expect(lightShape).not.toBeNull();
    expect(fillOf(lightShape!)).toBe("#dae8fc");
    // The contrast over the light fill: the black (the rgb(0, 0, 0)'s
    // stand).
    expect(textColorOf(lightShape!)).toBe("rgb(0, 0, 0)");

    // The token's fill stands verbatim (the adaptive's stand on its own —
    // the 3rd's item over the world's children's z-order).
    const world = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]')!;
    const fills = Array.from(world.children).map(fillOf);
    expect(fills).toContain("var(--docblocks-palette-blue)");
  });

  it("the dark theme stands the light fixed fill darkened (the muted's stand) + the white's text over the effective fill", async () => {
    setDark(true);
    await waitForDarkStore(true);
    renderEditor();

    const lightShape = screen.getByText("light").closest('[data-slot="docblocks/canvas-item"]');
    expect(lightShape).not.toBeNull();
    const fill = fillOf(lightShape!);
    // The darkened's stand: not the source's hex, the 6-digit's, the
    // dark's (the luminance's under).
    expect(fill).not.toBe("#dae8fc");
    expect(fill).toMatch(/^#[0-9a-f]{6}$/);
    expect(Number.parseInt(fill!.slice(1, 3), 16)).toBeLessThan(100);

    // The white's text over the effective (darkened's) fill.
    expect(textColorOf(lightShape!)).toBe("rgb(255, 255, 255)");
  });

  it("the dark theme stands the explicit textColor's data's stand (over the contrast's resolution)", async () => {
    setDark(true);
    await waitForDarkStore(true);
    renderEditor();

    // The `#1a1a1a`'s shape (the pass-through's dark fill) + the explicit's
    // `textColor: #ff0000` — the data's stand.
    const darkShape = screen.getByText("dark").closest('[data-slot="docblocks/canvas-item"]');
    expect(darkShape).not.toBeNull();
    expect(fillOf(darkShape!)).toBe("#1a1a1a");
    expect(textColorOf(darkShape!)).toBe("rgb(255, 0, 0)");
  });

  it("the flip re-renders the figures (the no-data's stand — the doc's JSON unchanged)", async () => {
    setDark(false);
    await waitForDarkStore(false);
    const doc = renderEditor();
    const before = JSON.stringify(doc.toJSON());

    const lightShape = screen.getByText("light").closest('[data-slot="docblocks/canvas-item"]')!;
    expect(fillOf(lightShape)).toBe("#dae8fc");

    // The flip (the class's stand — the store's re-render).
    setDark(true);
    await waitForDarkStore(true);
    const darkFill = fillOf(lightShape);
    expect(darkFill).not.toBe("#dae8fc");
    expect(textColorOf(lightShape)).toBe("rgb(255, 255, 255)");

    // The back's flip (the verbatim's stand).
    setDark(false);
    await waitForDarkStore(false);
    expect(fillOf(lightShape)).toBe("#dae8fc");

    // The data's stand (no CRDT's write, no wire, no persistence).
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });
});
