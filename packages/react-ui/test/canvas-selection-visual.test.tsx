// @vitest-environment jsdom
// The canvas selection's visual contract: the selected item's thin cyan
// outline over the tint, the marquee's line + the 50% fill (the cyan
// selection's tokens), and the selection's handles on the accent.
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { click, renderCanvas } from "./canvas-selection.helpers";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the visual contract", () => {
  it("stands the selected item's outline over the tint", () => {
    const r = renderCanvas();
    click(r, r.a);
    const wrapper = r.wrapperOf(r.a);
    expect(wrapper.className).toContain("bg-(--docblocks-selected-background)");
    expect(wrapper.className).toContain("outline-(--docblocks-canvas-selection-border-color)");
    expect(wrapper.className).toContain("outline-(length:--docblocks-canvas-selection-border-width)");
    expect(wrapper.className).toContain("outline-offset-1");
    // The unselected item stands neither.
    expect(r.wrapperOf(r.b).className).toBe("");
  });

  it("stands the marquee's line + the 50% fill (the cyan selection tokens)", () => {
    const r = renderCanvas();
    const start = r.view.getBoundingClientRect();
    const cx = start.x + start.width / 2;
    const cy = start.y + start.height / 2;
    fireEvent.pointerDown(r.view, { clientX: cx - 40, clientY: cy - 30, pointerId: 4 });
    fireEvent.pointerMove(r.view, { clientX: cx + 40, clientY: cy + 30, buttons: 1, pointerId: 4 });
    const marquee = r.view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-marquee']");
    expect(marquee).not.toBeNull();
    expect(marquee!.className).toContain("border-(--docblocks-canvas-selection-border-color)");
    expect(marquee!.className).toContain("border-(length:--docblocks-canvas-selection-border-width)");
    expect(marquee!.className).toContain("bg-(--docblocks-canvas-selection-fill)");
    expect(marquee!.className).not.toContain("bg-(--docblocks-selected-background)");
    expect(marquee!.className).not.toContain("border-(--docblocks-formatbar-border-color)");
    fireEvent.pointerUp(r.view, { pointerId: 4 });
  });

  it("stands the selection's handles on the accent (the cyan selection fill)", () => {
    const r = renderCanvas();
    click(r, r.a);
    const handles = Array.from(r.view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-handle']"));
    expect(handles.length).toBe(8); // the eight box handles
    for (const handle of handles) {
      expect(handle.className).toContain("bg-(--docblocks-canvas-selection-border-color)");
    }
    // The handle keeps the theme's thin border (the contrast ring).
    expect(handles[0]!.className).toContain("border-(--docblocks-formatbar-border-color)");
  });
});
