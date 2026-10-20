// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import type { SyncEmbedResolver } from "../src/EditorProvider";
import { MAX_EMBED_DEPTH } from "../src/blocks/SyncEmbedBlock";
import type { BlockRendererMap } from "../src/blocks/renderers";

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
  return document.querySelector<HTMLElement>('[data-block-type="sync-embed"]');
}

afterEach(() => {
  cleanup();
});

describe("states", () => {
  it("no resolver -> broken", () => {
    renderOuter({ docId: "master-1" }, { resolver: null });

    const wrapper = wrapperOf()!;
    expect(wrapper.getAttribute("data-state")).toBe("broken");
    expect(wrapper.getAttribute("data-doc-id")).toBe("master-1");
    expect(wrapper.textContent).toContain("unavailable");
    // The standard non-text contract: no nested editor, no gutter handle.
    expect(wrapper.querySelector('[data-slot="docblocks/editor"]')).toBeNull();
    expect(wrapper.querySelector("[contenteditable]")).toBeNull();
    expect(wrapper.querySelector('[data-slot="docblocks/gutter"]')).toBeNull();
  });

  it("a resolver that returns null -> broken", () => {
    renderOuter({ docId: "missing" }, { resolver: () => null });
    expect(wrapperOf()?.getAttribute("data-state")).toBe("broken");
  });

  it("a stale blockId (not in the master) -> broken", () => {
    const { master } = renderOuter({ docId: "master-1", blockId: "gone" });
    expect(master.getBlock("gone")).toBeNull();
    const wrapper = wrapperOf()!;
    expect(wrapper.getAttribute("data-state")).toBe("broken");
    expect(wrapper.querySelector('[data-slot="docblocks/sync-embed-body"]')).toBeNull();
  });

  it("a full-doc ref resolves: the master content renders inside, not in the outer list", () => {
    renderOuter({ docId: "master-1" });

    const wrapper = wrapperOf()!;
    expect(wrapper.getAttribute("data-state")).toBe("resolved");
    expect(wrapper.textContent).toContain(MASTER_HEADING);
    expect(wrapper.textContent).toContain(MASTER_P3);

    // The master's content is not in the outer block list: the blocks
    // rendered outside the wrapper are the outer doc's own only.
    const outerHeadings = Array.from(document.querySelectorAll<HTMLElement>('[data-block-type="heading"]')).filter(
      (el) => !wrapper.contains(el)
    );
    const outerParagraphs = Array.from(document.querySelectorAll<HTMLElement>('[data-block-type="paragraph"]')).filter(
      (el) => !wrapper.contains(el)
    );
    expect(outerHeadings).toHaveLength(0);
    // The outer doc ends with the sync-embed (a non-text last block) — the
    // editor's tail guarantee stands the trailing empty paragraph over it.
    expect(outerParagraphs.map((el) => el.textContent)).toEqual(["Outer paragraph", ""]);
  });

  it("a subtree ref resolves: only the subtree block renders in the region", () => {
    renderOuter({ docId: "master-1", blockId: "m0003" });

    const wrapper = wrapperOf()!;
    expect(wrapper.getAttribute("data-state")).toBe("resolved");
    expect(wrapper.textContent).toContain(MASTER_P2);
    // The master's other blocks are absent from the embed region.
    expect(wrapper.textContent).not.toContain(MASTER_HEADING);
    expect(wrapper.textContent).not.toContain(MASTER_P1);
    expect(wrapper.textContent).not.toContain(MASTER_P3);
    // The nested editor renders the subtree root itself (the store entry list is [m0003]).
    const nested = wrapper.querySelector('[data-slot="docblocks/editor"] [data-block-id="m0003"]');
    expect(nested).not.toBeNull();
  });

  it("a container subtree renders the whole subtree (nested children included)", () => {
    const master = createDoc({ id: "master-1", createdAt: CREATED_AT, generateId: masterIdGenerator() });
    master.transact(() => {
      const item = master.insertBlock("list-item", { list: "bullet" });
      master.insertText(item, 0, "Outer item");
      const nested = master.insertBlock("list-item", { list: "bullet", indent: 1 });
      master.insertText(nested, 0, "Nested item");
    });
    renderOuter({ docId: "master-1", blockId: "m0001" }, { master });

    const wrapper = wrapperOf()!;
    expect(wrapper.getAttribute("data-state")).toBe("resolved");
    expect(wrapper.textContent).toContain("Outer item");
    expect(wrapper.textContent).toContain("Nested item");
  });

  it("a ref re-entering the ancestor doc chain -> cycle", () => {
    const master = seedMaster("master-1");
    // The master embeds the outer doc: the visited-set must stop it.
    master.insertBlock("sync-embed", { ref: { docId: "outer" } });
    const outer = seedOuter({ docId: "master-1" });
    const resolver: SyncEmbedResolver = (r) => (r.docId === "master-1" ? master : r.docId === "outer" ? outer : null);

    render(
      <EditorProvider doc={outer} syncEmbedResolver={resolver}>
        <Editor />
      </EditorProvider>
    );

    const wrappers = Array.from(document.querySelectorAll<HTMLElement>('[data-block-type="sync-embed"]'));
    expect(wrappers).toHaveLength(2);
    const states = wrappers.map((el) => el.getAttribute("data-state"));
    expect(states).toContain("resolved");
    expect(states).toContain("cycle");
    // The cycle placeholder renders instead of a nested editor.
    expect(
      wrapperOf()!.querySelector('[data-slot="docblocks/sync-embed-placeholder"][data-state="cycle"]')
    ).not.toBeNull();
  });

  it("a doc chain longer than the depth bound -> the deepest embed is a cycle", () => {
    // A linear chain of docs (no loop): only the depth bound can stop it.
    const COUNT = 11;
    const docs: TestDoc[] = [];
    for (let i = 0; i < COUNT; i += 1) docs.push(createDoc({ id: `d${i}`, createdAt: CREATED_AT }));
    docs.forEach((doc, index) => {
      if (index < COUNT - 1) doc.insertBlock("sync-embed", { ref: { docId: `d${index + 1}` } });
    });
    const resolver: SyncEmbedResolver = (r) => docs.find((doc) => doc.meta.id === r.docId) ?? null;

    render(
      <EditorProvider doc={docs[0]!} syncEmbedResolver={resolver}>
        <Editor />
      </EditorProvider>
    );

    const wrappers = Array.from(document.querySelectorAll<HTMLElement>('[data-block-type="sync-embed"]'));
    expect(wrappers).toHaveLength(COUNT - 1);
    const states = wrappers.map((el) => el.getAttribute("data-state"));
    // Depths 0..MAX_EMBED_DEPTH resolve; the next one shows the cycle placeholder.
    expect(states.filter((state) => state === "resolved")).toHaveLength(MAX_EMBED_DEPTH + 1);
    expect(states.filter((state) => state === "cycle")).toHaveLength(1);
  });
});

describe("editing through the embed", () => {
  it("a command to the master doc updates the nested store and leaves the outer doc untouched", () => {
    const { outer, master } = renderOuter({ docId: "master-1" });
    const outerBefore = outer.toJSON();

    // The nested provider's doc IS the master: a command there is the
    // store-level edit the e2e performs with real keystrokes.
    act(() => {
      master.insertText("m0002", 0, "Edited ");
    });

    const inner = document.querySelector<HTMLElement>(
      '[data-slot="docblocks/sync-embed-body"] [data-block-id="m0002"] [data-slot="docblocks/block-content"]'
    );
    expect(inner?.textContent).toBe(`Edited ${MASTER_P1}`);
    expect(master.getText("m0002")).toBe(`Edited ${MASTER_P1}`);
    // The outer doc's JSON is untouched (the ref only, never the master content).
    expect(outer.toJSON()).toEqual(outerBefore);
    expect(JSON.stringify(outer.toJSON())).not.toContain(MASTER_P1);
  });
});

describe("subtree projection (the derived segment)", () => {
  it("re-derives on change: a peer insert into the segment grows it, a removal shrinks it, the untouched blocks keep identity", () => {
    const { master } = renderOuter({ docId: "master-1", blockId: "m0003" });
    const wrapper = wrapperOf()!;
    const editor = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!;
    expect(editor).not.toBeNull();

    // The seed: the segment is the subtree root alone (m0004 follows at
    // indent 0 — outside the segment).
    expect(editor.querySelector('[data-block-id="m0003"]')).not.toBeNull();
    expect(editor.querySelector('[data-block-id="m0004"]')).toBeNull();
    const firstM0003 = editor.querySelector<HTMLElement>('[data-block-id="m0003"]')!;

    // An unrelated change (m0002 stands outside the segment): the
    // re-derivation runs, the segment stands, and the subtree root's node
    // is not remounted (the store keeps the block's snapshot reference).
    act(() => {
      master.insertText("m0002", 0, "Edited ");
    });
    expect(wrapper.querySelector('[data-block-id="m0003"]')).toBe(firstM0003);
    expect(editor.querySelector('[data-block-id="m0004"]')).toBeNull();

    // A DEEPER block is inserted into the segment (after the root, indent
    // 1): the insert touches no subtree root — only the projection's
    // re-derivation sees it (the segment grows without the nested editor
    // remounting).
    let childId = "";
    act(() => {
      childId = master.insertBlock("paragraph", { indent: 1 }, { parent: master.meta.id, after: "m0003" });
      master.insertText(childId, 0, "Master subtree child");
    });
    expect(wrapper.querySelector('[data-block-id="m0003"]')).toBe(firstM0003);
    expect(wrapper.textContent).toContain("Master subtree child");
    expect(editor.querySelector(`[data-block-id="${childId}"]`)).not.toBeNull();

    // A second deeper block after the child: the segment grows again.
    let grandchildId = "";
    act(() => {
      grandchildId = master.insertBlock("paragraph", { indent: 2 }, { parent: master.meta.id, after: childId });
    });
    expect(wrapper.textContent).toContain("Master subtree child");
    expect(editor.querySelector(`[data-block-id="${grandchildId}"]`)).not.toBeNull();

    // The removal shrinks the segment back to the root (the core
    // removeBlock cascades the derived segment — one call removes both):
    // the rows unmount, the subtree root's node still stands (no remount
    // across the grow/shrink cycle).
    act(() => {
      master.removeBlock(childId);
    });
    expect(wrapper.querySelector('[data-block-id="m0003"]')).toBe(firstM0003);
    expect(editor.querySelector(`[data-block-id="${childId}"]`)).toBeNull();
    expect(editor.querySelector(`[data-block-id="${grandchildId}"]`)).toBeNull();
    expect(wrapper.textContent).not.toContain("Master subtree child");
  });
});

describe("renderer registry: sync-embed", () => {
  it("a consumer renderer for sync-embed replaces the built-in", () => {
    renderOuter(
      { docId: "master-1" },
      {
        blockRenderers: {
          "sync-embed": ({ id, block }) => (
            <div
              data-testid="custom-sync-embed"
              data-custom-id={id}
              data-custom-doc-id={block.type === "sync-embed" ? block.attrs.ref.docId : ""}
            />
          ),
        },
      }
    );

    const custom = document.querySelector("[data-testid='custom-sync-embed']");
    expect(custom).not.toBeNull();
    expect(custom?.getAttribute("data-custom-doc-id")).toBe("master-1");
    expect(document.querySelector('[data-slot="docblocks/sync-embed-body"]')).toBeNull();
  });

  it("a malformed ref literal is a type error and throws at runtime", () => {
    const doc = createDoc({ id: "scratch", createdAt: CREATED_AT });
    expect(() => {
      // @ts-expect-error — the ref is an object, not a string
      doc.insertBlock("sync-embed", { ref: "master-1" });
    }).toThrow();
  });
});
