// @vitest-environment jsdom
// The lazy image placeholder: the aspect-ratio reservation from the
// metadata's dimensions, the read-only modes' resolution, and the resolved
// image element's native loading attributes.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import {
  enterBand,
  image,
  imageDoc,
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

describe("the lazy image placeholder", () => {
  it("reserves the aspect ratio from the metadata's dimensions", async () => {
    standObservers();
    standBelowFold();
    const { store } = makeStore({
      meta: { name: "pic.png", mimeType: "image/png", width: 1200, height: 800 },
      getMeta: true,
    });

    renderImage(store);
    await act(async () => {});

    expect(placeholder()?.style.aspectRatio).toBe("1200 / 800");
  });

  it("stands the placeholder without a reservation over the absent dimensions", async () => {
    standObservers();
    standBelowFold();
    const { store } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" }, getMeta: true });

    renderImage(store);
    await act(async () => {});

    expect(placeholder()?.style.aspectRatio).toBe("");
  });

  it("frames the preload band on the consumer's scroll container", async () => {
    standObservers();
    standBelowFold();
    const scroller = document.createElement("div");
    // The scroller's visible box sits above the placeholder (the observer's
    // path, not the first screen's).
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
    const { store } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" }, getMeta: true });

    renderImage(store, { scrollContainer: scroller });
    await act(async () => {});

    // The window-rooted observer never sees a box clipped by the inner
    // scroller: the band and the above-the-fold measure take the root.
    expect(observers[0]?.options?.root).toBe(scroller);
  });

  it("inherits the enclosing scroll container over the absent own prop", async () => {
    standObservers();
    standBelowFold();
    const scroller = document.createElement("div");
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
    const { store } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" }, getMeta: true });
    const outer = imageDoc();

    render(
      <EditorProvider doc={outer.doc} blobStore={store} scrollContainer={scroller}>
        <EditorProvider doc={imageDoc().doc} blobStore={store}>
          <Editor />
        </EditorProvider>
      </EditorProvider>
    );
    await act(async () => {});

    expect(observers[0]?.options?.root).toBe(scroller);
  });

  it("frames an explicit null scroll container on the window (the nested opt-out)", async () => {
    standObservers();
    standBelowFold();
    const scroller = document.createElement("div");
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
    const { store } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" }, getMeta: true });

    render(
      <EditorProvider doc={imageDoc().doc} blobStore={store} scrollContainer={scroller}>
        <EditorProvider doc={imageDoc().doc} blobStore={store} scrollContainer={null}>
          <Editor />
        </EditorProvider>
      </EditorProvider>
    );
    await act(async () => {});

    expect(observers[0]?.options?.root).toBeNull();
  });

  it("resolves the bytes over the read-only (view) mode", async () => {
    standObservers();
    standBelowFold();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:view");
    const { store } = makeStore({ meta: { name: "pic.png", mimeType: "image/png" } });

    renderImage(store, { mode: "view" });
    await act(async () => {});
    enterBand();
    await act(async () => {});

    expect(image()?.getAttribute("src")).toBe("blob:view");
  });

  it("stands the native lazy loading, the async decode, and the box reservation on the img", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:native");
    const { store } = makeStore({
      meta: { name: "pic.png", mimeType: "image/png", width: 1200, height: 800 },
      getMeta: true,
    });

    renderImage(store);
    await act(async () => {});

    const img = image();
    expect(img).not.toBeNull();
    // The bytes are library-resolved (the object URL exists before the
    // element mounts): the native lazy loading defers the decode.
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");
    // The intrinsic dimensions reserve the box before the decode.
    expect(img!.getAttribute("width")).toBe("1200");
    expect(img!.getAttribute("height")).toBe("800");
  });
});
