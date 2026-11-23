// @vitest-environment jsdom
// The cover's upload's modal (the mode's selector, the drop zone's
// stands, the gate's hint, the commit over the upload, the Escape's
// close) and the preset's grid (the 4-column's grid over the passed's
// ids, the mode's switch's set's switch, the pick's commit).
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  modalDialog,
  modalHint,
  modalInput,
  modalModeButton,
  png,
  renderCover,
  storeWith,
  stubDecodable,
  uploadButton,
} from "./cover-upload.helpers";

describe("the cover upload's modal", () => {
  it("opens over the upload's press (the tile's default's stand)", () => {
    renderCover(storeWith([]));
    expect(modalDialog()).toBeNull();
    fireEvent.click(uploadButton()!);
    expect(modalDialog(), "the modal stands over the press").not.toBeNull();
    expect(modalModeButton("tile")?.getAttribute("aria-pressed")).toBe("true");
    // The strict's accept's stand (the webp's parity).
    expect(modalInput()!.getAttribute("accept")).toContain("image/webp");
    // The preset's grid stands absent (the consumer's catalog's absence),
    // the enlarged's base's stand's size.
    expect(
      document.querySelector('[data-slot="docblocks/cover-preset-grid"]'),
      "the grid's absence's stand"
    ).toBeNull();
    expect(modalDialog()!.classList.contains("w-110"), "the enlarged's base's stand").toBe(true);
  });

  it("commits the tall image over the default mode (the upload + the close)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    fireEvent.change(modalInput()!, { target: { files: [png("tall.png")] } });
    await act(async () => {
      probe.resolve(800, 300);
    });

    expect(uploads).toHaveLength(1);
    expect(commits).toEqual([["id-1", "tile"]]);
    expect(modalDialog(), "the modal closes over the commit").toBeNull();
    expect(modalHint()).toBeNull();
  });

  it("rejects the short image over the tile (the hint's stand, the no upload)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    fireEvent.change(modalInput()!, { target: { files: [png("short.png")] } });
    await act(async () => {
      probe.resolve(800, 100);
    });

    expect(uploads, "the rejection stands the no upload").toHaveLength(0);
    expect(commits).toHaveLength(0);
    expect(modalHint(), "the hint stands").not.toBeNull();
    expect(modalHint()!.textContent).toContain("150");
    expect(modalDialog(), "the modal keeps open").not.toBeNull();
  });

  it("rejects the unsupported type (the MIME's gate, the hint's stand)", async () => {
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    const gif = new File([new Uint8Array(4)], "x.gif", { type: "image/gif" });
    fireEvent.change(modalInput()!, { target: { files: [gif] } });
    await act(async () => {});

    expect(uploads).toHaveLength(0);
    expect(commits).toHaveLength(0);
    expect(modalHint()!.textContent).toContain("PNG");
    expect(modalDialog()).not.toBeNull();
  });

  it("commits over the selected mode (the centering's delivery)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    fireEvent.click(modalModeButton("center")!);
    expect(modalModeButton("center")?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(modalInput()!, { target: { files: [png("wide.png")] } });
    await act(async () => {
      probe.resolve(1200, 300);
    });

    expect(commits).toEqual([["id-1", "center"]]);
    expect(modalDialog()).toBeNull();
  });

  it("closes over the Escape (the no commit's stand)", async () => {
    renderCover(storeWith([]));
    fireEvent.click(uploadButton()!);
    expect(modalDialog()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(modalDialog(), "the modal closes over the Escape").toBeNull();
  });

  it("delivers the dropped file (the drag-and-drop's stand)", async () => {
    const probe = stubDecodable();
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads));
    fireEvent.click(uploadButton()!);
    const dropzone = document.querySelector<HTMLButtonElement>('[data-slot="docblocks/cover-upload-dropzone"]');
    expect(dropzone).not.toBeNull();
    fireEvent.drop(dropzone!, { dataTransfer: { files: [png("dropped.png")] } });
    await act(async () => {
      probe.resolve(800, 300);
    });

    expect(uploads).toHaveLength(1);
    expect(commits).toEqual([["id-1", "tile"]]);
    expect(modalDialog()).toBeNull();
  });
});

describe("the cover's preset's grid", () => {
  const TILE_PRESETS = ["tile-1", "tile-2", "tile-3", "tile-4", "tile-5"];
  const CENTER_PRESETS = ["center-1", "center-2"];

  it("stands the 4-column's grid over the passed ids (the scrollable's stand, the enlarged's size)", () => {
    renderCover(storeWith([]), { tile: TILE_PRESETS, center: CENTER_PRESETS });
    fireEvent.click(uploadButton()!);
    const grid = document.querySelector('[data-slot="docblocks/cover-preset-grid"]');
    expect(grid, "the grid stands over the passed's stand").not.toBeNull();
    // The enlarged's stand (the preset's stand's size).
    expect(modalDialog()!.classList.contains("w-140")).toBe(true);
    // The 4-column's stand over the thin-scrollbar's ScrollArea (the
    // visible's 3-row's cap's class over the scroll container's stand).
    const cells = document.querySelector<HTMLElement>('[data-slot="docblocks/cover-preset-cells"]');
    expect(cells).not.toBeNull();
    expect(cells!.classList.contains("grid-cols-4")).toBe(true);
    const scroll = cells!.closest("[data-slot='scroll-area']");
    expect(scroll, "the scroll area's stand").not.toBeNull();
    expect((scroll as HTMLElement).classList.contains("max-h-58"), "the 3-row's cap over the scroll's stand").toBe(
      true
    );
    const thumbs = Array.from(document.querySelectorAll('[data-slot="docblocks/cover-preset"]'));
    expect(thumbs, "the cell's stand over every passed id").toHaveLength(TILE_PRESETS.length);
    expect(thumbs[0]!.getAttribute("data-cover-preset-id")).toBe("tile-1");
  });

  it("the mode's switch stands the set's switch (the grid's stand stands)", () => {
    renderCover(storeWith([]), { tile: TILE_PRESETS, center: CENTER_PRESETS });
    fireEvent.click(uploadButton()!);
    expect(document.querySelectorAll('[data-slot="docblocks/cover-preset"]')).toHaveLength(TILE_PRESETS.length);
    fireEvent.click(modalModeButton("center")!);
    // The same grid's stand over the other set (the set's switch's stand).
    const thumbs = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/cover-preset"]'));
    expect(thumbs).toHaveLength(CENTER_PRESETS.length);
    expect(thumbs[0]!.getAttribute("data-cover-preset-id")).toBe("center-1");
  });

  it("a pick commits the id over the mode (the upload's no stand, the close's stand)", () => {
    const uploads: File[] = [];
    const { commits } = renderCover(storeWith(uploads), { tile: TILE_PRESETS });
    fireEvent.click(uploadButton()!);
    const thumb = document.querySelector('[data-slot="docblocks/cover-preset"][data-cover-preset-id="tile-2"]');
    expect(thumb).not.toBeNull();
    fireEvent.click(thumb!);
    expect(commits).toEqual([["tile-2", "tile"]]);
    expect(uploads, "the pick stands the upload's no write").toHaveLength(0);
    expect(modalDialog(), "the modal closes over the pick").toBeNull();
  });

  it("stands absent over the mode's empty set (the other set's grid's absence)", () => {
    renderCover(storeWith([]), { center: CENTER_PRESETS });
    fireEvent.click(uploadButton()!);
    // The tile's set's absence stands no grid (the modal's size stands the
    // passed set's enlarged's stand over the other set's presence).
    expect(
      document.querySelector('[data-slot="docblocks/cover-preset-grid"]'),
      "the grid's absence's stand"
    ).toBeNull();
    expect(modalDialog()!.classList.contains("w-140")).toBe(true);
    fireEvent.click(modalModeButton("center")!);
    expect(document.querySelectorAll('[data-slot="docblocks/cover-preset"]')).toHaveLength(CENTER_PRESETS.length);
  });
});
