// @vitest-environment jsdom
// The lazy blob resolution: the metadata's head phase at mount, the bytes'
// phase behind the viewport gate, the previous-view stand over the store's
// change, the unmount's object URL's stand, and the eager policy.
import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BlobRef } from "../src/blob-store";
import {
  IMAGE_ID,
  enterBand,
  image,
  makeStore,
  observers,
  placeholder,
  renderImage,
  resetLazyStand,
  standBelowFold,
  standObservers,
} from "./lazy-blob.helpers";

afterEach(() => {
  cleanup();
  resetLazyStand();
});

describe("the lazy blob resolution", () => {
  it("looks up the metadata at mount and holds the bytes until the block enters the band", async () => {
    standObservers();
    standBelowFold();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:lazy");
    const { store, get, getMeta } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" }, getMeta: true });

    renderImage(store);
    await act(async () => {});

    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(placeholder()?.getAttribute("data-state")).toBe("loading");

    enterBand();
    await act(async () => {});

    // The band's entry reuses the head the mount's phase resolved.
    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(image()?.getAttribute("src")).toBe("blob:lazy");
    expect(placeholder()).toBeNull();
  });

  it("keeps the resolved view over the store's change (no placeholder's return)", async () => {
    standObservers();
    standBelowFold();
    let sequence = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:seq-${++sequence}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { store, get } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" }, getMeta: true });

    renderImage(store);
    await act(async () => {});
    enterBand();
    await act(async () => {});
    expect(image()?.getAttribute("src")).toBe("blob:seq-1");

    // The store's rename re-resolves the metadata; the resolved view stands
    // over the in-flight pass (the previous-view stand), then the fresh URL
    // replaces it.
    await act(async () => {
      await store.rename(IMAGE_ID, "pic2.png");
    });
    expect(image()).not.toBeNull();
    expect(placeholder()).toBeNull();
    await act(async () => {});
    expect(get).toHaveBeenCalledTimes(2);
    expect(image()?.getAttribute("src")).toBe("blob:seq-2");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:seq-1");
  });

  it("holds the previous view over a store change outside the band", async () => {
    standObservers();
    standBelowFold();
    const { store, get } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" } });

    renderImage(store);
    await act(async () => {});
    enterBand();
    await act(async () => {});
    expect(get).toHaveBeenCalledTimes(1);

    // The block leaves the band: the store's change keeps the resolved view
    // and does not re-fetch the bytes.
    enterBand(false);
    await act(async () => {
      await store.rename(IMAGE_ID, "pic2.png");
    });
    await act(async () => {});
    expect(get).toHaveBeenCalledTimes(1);
    expect(image()).not.toBeNull();
  });

  it("lands no object URL over an unmount before the bytes resolve", async () => {
    standObservers();
    standBelowFold();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:late");
    const { store } = makeStore({
      meta: { name: "pic.png", mimeType: "image/png" },
      getMeta: true,
      get: () => new Promise<BlobRef>(() => {}),
    });

    const { unmount } = renderImage(store);
    await act(async () => {});
    enterBand();
    await act(async () => {});
    unmount();
    await act(async () => {});

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("resolves every block at mount over the eager policy", async () => {
    standObservers();
    standBelowFold();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:eager");
    const { store, get } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" } });

    renderImage(store, { blobLoading: "eager" });
    await act(async () => {});

    expect(observers).toHaveLength(0);
    expect(get).toHaveBeenCalledTimes(1);
    expect(image()?.getAttribute("src")).toBe("blob:eager");
  });
});
