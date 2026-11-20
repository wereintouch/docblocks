// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { pressPointOf } from "./canvas-press";
import { IDS, renderScene } from "./canvas-scene";

afterEach(cleanup);

describe("canvas: frame (the viewport window)", () => {
  it("renders the boundary (the border) and stands no content copy", () => {
    const doc = renderScene({ view: "canvas" });
    const frame = document.querySelector<HTMLElement>(`[data-slot="docblocks/frame"][data-block-id="${IDS.frame}"]`)!;
    expect(frame).not.toBeNull();
    const box = frame.querySelector<HTMLElement>("[data-slot='docblocks/frame-boundary']")!;
    // The boundary: a transparent region marker (no content copy, no
    // canvas background, no dot grid — the canvas's own figures stand
    // behind it).
    expect(box.className).toContain("rounded-(--docblocks-radius)");
    expect(box.style.backgroundColor).toBe("");
    expect(box.style.backgroundImage).toBe("");
    // The container's thin rounded border: the 1px inset ring (the resting
    // stand over the canvas group's border token).
    expect(box.style.boxShadow).toBe("inset 0 0 0 1px var(--docblocks-canvas-group-border-color)");
    // The frame is childless: the boundary stands no nested content.
    expect(doc.getChildren(IDS.frame)).toEqual([]);
    expect(frame.querySelector("h1")).toBeNull();
    // The boundary stands no mirror's content (the canvas frame is a region
    // marker — the mirror's render stands on the page-frame block).
    expect(frame.querySelector("[data-slot='docblocks/frame-window-content']")).toBeNull();
  });

  it("stands the selection's outline over the window (the ring's switch to the selection's color)", () => {
    const doc = renderScene({ view: "canvas" });
    const view = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    const wrapper = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.frame}"]`
    )!;
    const box = wrapper.querySelector<HTMLElement>("[data-slot='docblocks/frame-boundary']")!;
    expect(wrapper.hasAttribute("data-selected")).toBe(false);
    expect(box.style.outline).toBe("");
    // The press on the frame's border band selects the frame (the
    // window's interior stands transparent to the press): select + the
    // move session.
    const p = pressPointOf(doc, IDS.frame);
    fireEvent.pointerDown(view, { button: 0, clientX: p.x, clientY: p.y, pointerId: 1 });
    fireEvent.pointerUp(view, { pointerId: 1 });
    expect(wrapper.getAttribute("data-selected")).toBe("true");
    // The ring stands the selection's color (the wrapper's outline stands
    // the shared selection's stand).
    expect(box.style.outline).toBe(
      "var(--docblocks-canvas-selection-border-width) solid var(--docblocks-canvas-selection-border-color)"
    );
    expect(box.style.boxShadow).toBe("inset 0 0 0 1px var(--docblocks-canvas-selection-border-color)");
  });

  it("stands the title chip (the chip's stand, the empty's removed stand)", () => {
    const doc = renderScene({ view: "canvas" });
    // The chip stands over the screen layer, seated on the frame's own box
    // (the occlusion-free stand — not inside the item's wrapper).
    const seat = () =>
      document.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-title-chip"][data-block-id="${IDS.frame}"]`);
    expect(seat()?.querySelector("[data-slot='docblocks/frame-title']") ?? null).toBeNull(); // the absent's off
    act(() => {
      doc.updateBlock(IDS.frame, { title: "My frame" });
    });
    const chip = seat()?.querySelector<HTMLElement>("[data-slot='docblocks/frame-title']") ?? null;
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("My frame");
    act(() => {
      doc.updateBlock(IDS.frame, { title: "" });
    });
    expect(seat()?.querySelector("[data-slot='docblocks/frame-title']") ?? null).toBeNull(); // the empty's off
  });

  it("enters the title's inline edit on the chip's double-click and commits on the blur (one updateBlock)", () => {
    const doc = renderScene({ view: "canvas" });
    act(() => {
      doc.updateBlock(IDS.frame, { title: "First" });
    });
    const chip = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-title-chip"][data-block-id="${IDS.frame}"] [data-slot='docblocks/frame-title']`
    )!;
    fireEvent.dblClick(chip);
    const edit = document.querySelector<HTMLElement>("[data-slot='docblocks/frame-title-edit']")!;
    expect(edit).not.toBeNull();
    expect(edit.getAttribute("aria-label")).toBe("Frame title");
    expect((edit as HTMLInputElement).value).toBe("First");
    // The commit (the blur): one updateBlock over the frame's title.
    const editInput = edit as HTMLInputElement;
    editInput.value = "First — edited";
    fireEvent.blur(edit);
    const frame = doc.getBlock(IDS.frame);
    expect(frame?.type === "frame" && frame.attrs?.title).toBe("First — edited");
  });

  it("stands the set-title menu on the selection over the title-less frame (the commit's one updateBlock)", () => {
    const doc = renderScene({ view: "canvas" });
    const view = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    // The selection (the title-less stand): the press on the frame's
    // border band, the menu's trigger stands at the title's seat over
    // the screen layer.
    const p = pressPointOf(doc, IDS.frame);
    fireEvent.pointerDown(view, { button: 0, clientX: p.x, clientY: p.y, pointerId: 1 });
    fireEvent.pointerUp(view, { pointerId: 1 });
    const seat = () =>
      document.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-title-chip"][data-block-id="${IDS.frame}"]`)!;
    const menu = seat().querySelector<HTMLElement>("[data-slot='docblocks/frame-title-menu']");
    expect(menu).not.toBeNull();
    expect(menu!.getAttribute("aria-label")).toBe("Set frame title");
    fireEvent.click(menu!);
    const input = seat().querySelector<HTMLElement>("[data-slot='docblocks/frame-title-menu-input']")!;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "Seated" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const block = doc.getBlock(IDS.frame);
    expect(block?.type === "frame" && block.attrs?.title).toBe("Seated");
    // The menu closes, the chip stands over the title's commit.
    expect(seat().querySelector("[data-slot='docblocks/frame-title']")!.textContent).toBe("Seated");
  });
});
