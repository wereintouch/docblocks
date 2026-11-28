// The sync-embed tests' shared stand: the master's seed (the
// deterministic's ids), the outer doc's seed (the fixed's layout the
// locators rely on), the render fixture (the resolver's stand + the
// nested's registry), the wrapper's read, and the per-test's cleanup.
import { cleanup, render } from "@testing-library/react";
import { afterEach } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import { EditorProvider } from "../src/editor-provider";
import type { SyncEmbedResolver } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

const MASTER_HEADING = "Master heading";
const MASTER_P1 = "Master paragraph one";
const MASTER_P2 = "Master subtree paragraph";
const MASTER_P3 = "Master paragraph three";

type TestDoc = ReturnType<typeof createDoc>;

/** Deterministic master ids: m0001 heading, m0002-m0004 paragraphs. */
function masterIdGenerator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `m${String(next).padStart(4, "0")}`;
  };
}

/** The pane-style master seed (heading + paragraphs; m0003 is the subtree target). */
function seedMaster(id: string): TestDoc {
  const doc = createDoc({ id, createdAt: CREATED_AT, generateId: masterIdGenerator() });
  doc.transact(() => {
    const heading = doc.insertBlock("heading", { level: 1 });
    doc.insertText(heading, 0, MASTER_HEADING);
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, MASTER_P1);
    const p2 = doc.insertBlock("paragraph");
    doc.insertText(p2, 0, MASTER_P2);
    const p3 = doc.insertBlock("paragraph");
    doc.insertText(p3, 0, MASTER_P3);
  });
  return doc;
}

/** The outer doc: one paragraph, then the sync-embed (the fixed layout the locators rely on). */
function seedOuter(ref: { docId: string; blockId?: string }): TestDoc {
  const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
  doc.transact(() => {
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "Outer paragraph");
    doc.insertBlock("sync-embed", { ref });
  });
  return doc;
}

interface RenderOptions {
  /** null — no resolver prop on the provider (the broken-state test). */
  resolver?: SyncEmbedResolver | null;
  master?: TestDoc;
  blockRenderers?: BlockRendererMap;
}

/** Seed the outer doc, then render the provider + editor around the sync-embed. */
function renderOuter(ref: { docId: string; blockId?: string }, options?: RenderOptions) {
  const master = options?.master ?? seedMaster("master-1");
  const outer = seedOuter(ref);
  // `null` omits the prop (the no-resolver state); an absent option resolves
  // the seeded master (the default, pane-like, resolver).
  const resolver =
    (options?.resolver === undefined
      ? (r: { docId: string }) => (r.docId === master.meta.id ? master : null)
      : options.resolver) ?? undefined;
  render(
    <EditorProvider doc={outer} syncEmbedResolver={resolver} blockRenderers={options?.blockRenderers}>
      <Editor />
    </EditorProvider>
  );
  return { outer, master };
}

/** The first sync-embed wrapper in document order (the outermost one). */
function wrapperOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-block-type="sync-embed"]:not([data-slot="docblocks/row"])');
}

afterEach(() => {
  cleanup();
});

export {
  CREATED_AT,
  MASTER_HEADING,
  MASTER_P1,
  MASTER_P2,
  MASTER_P3,
  masterIdGenerator,
  renderOuter,
  seedMaster,
  seedOuter,
  wrapperOf,
};
export type { TestDoc };
