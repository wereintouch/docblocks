// @vitest-environment jsdom
// The lazy blob resolution's shared stand: the IntersectionObserver stub, the
// below-the-fold geometry, the band's entry, the store fixture with the
// metadata's head phase, the image doc's render, and the DOM reads.
import { act, render } from "@testing-library/react";
import { expect, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobMeta, BlobRef, BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";
import type { EditorProviderProps } from "../src/editor-provider";

const CREATED_AT = "2026-11-23T00:00:00.000Z";
const IMAGE_ID = "img-1";

interface ObserverRecord {
  callback: IntersectionObserverCallback;
  observed: Element[];
}

const observers: ObserverRecord[] = [];

class FakeIntersectionObserver {
  readonly record: ObserverRecord;

  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, observed: [] };
    observers.push(this.record);
  }

  observe(element: Element): void {
    this.record.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Every element's box sits below the fold (the observer's band decides). */
function standBelowFold(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 2_000,
    bottom: 2_100,
    left: 0,
    right: 100,
    width: 100,
    height: 100,
    x: 0,
    y: 2_000,
    toJSON: () => ({}),
  } as DOMRect);
}

/** Stand the observer stub over the page (the fixture's teardown resets it). */
function standObservers(): void {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
}

function enterBand(isIntersecting = true): void {
  const record = observers[0];
  expect(record, "the viewport observer should stand").toBeDefined();
  act(() => {
    record!.callback([{ isIntersecting } as IntersectionObserverEntry], record as unknown as IntersectionObserver);
  });
}

interface StoreHarness {
  store: BlobStore;
  get: ReturnType<typeof vi.fn>;
  getMeta: ReturnType<typeof vi.fn>;
}

function makeStore(options: { meta: BlobMeta; getMeta?: boolean; get?: () => Promise<BlobRef> }): StoreHarness {
  const metaState = { ...options.meta };
  const get = vi.fn(
    options.get ?? (async (): Promise<BlobRef> => ({ blob: new Blob(["bytes"]), meta: { ...metaState } }))
  );
  const getMeta = vi.fn(async (): Promise<BlobMeta> => ({ ...metaState }));
  const listeners = new Map<string, Set<() => void>>();
  const store: BlobStore = {
    get,
    upload: async () => "up-1",
    rename: async (fileId, name) => {
      metaState.name = name;
      for (const listener of listeners.get(fileId) ?? []) listener();
      return { ...metaState };
    },
    subscribe: (fileId, onChange) => {
      let entries = listeners.get(fileId);
      if (entries === undefined) {
        entries = new Set();
        listeners.set(fileId, entries);
      }
      entries.add(onChange);
      return () => {
        entries.delete(onChange);
      };
    },
  };
  if (options.getMeta === true) store.getMeta = getMeta;
  return { store, get, getMeta };
}

function imageDoc(): { doc: Doc; imageId: string } {
  const doc = createDoc({ id: "doc-lazy", createdAt: CREATED_AT });
  const imageId = doc.insertBlock("image", { src: IMAGE_ID });
  return { doc, imageId };
}

function renderImage(store: BlobStore, props: Partial<EditorProviderProps> = {}) {
  const { doc, imageId } = imageDoc();
  const utils = render(
    <EditorProvider doc={doc} blobStore={store} {...props}>
      <Editor />
    </EditorProvider>
  );
  return { doc, imageId, ...utils };
}

function placeholder(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="docblocks/image-placeholder"]');
}

function image(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>('[data-slot="docblocks/image"]');
}

/** Reset the per-test stands (the suite's afterEach). */
function resetLazyStand(): void {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  observers.length = 0;
}

export {
  CREATED_AT,
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
};
