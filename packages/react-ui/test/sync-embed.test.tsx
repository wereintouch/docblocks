// @vitest-environment jsdom
// The sync-embed's states (the broken's / the resolved's / the cycle's
// stands, the ref's removal's transition + the restore's back) and the
// editing through the embed (the master's command updates the nested's
// store; the outer's doc stands untouched).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { MAX_EMBED_DEPTH } from "../src/blocks/SyncEmbedBlock";
import { EditorProvider } from "../src/editor-provider";
import type { SyncEmbedResolver } from "../src/editor-provider";
import {
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
} from "./sync-embed.helpers";
import type { TestDoc } from "./sync-embed.helpers";

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

  it("the ref's block removed from the master over the mount stands the broken's transition (and the restore's back)", () => {
    // The dynamic stand: the stale's check runs at the render, so the
    // removal (the master's transaction) must re-stand the block to reach
    // it — the mount-time's stale pin stands the render-time's state only.
    const { master } = renderOuter({ docId: "master-1", blockId: "m0003" });
    expect(wrapperOf()!.getAttribute("data-state")).toBe("resolved");

    act(() => {
      master.removeBlock("m0003");
    });
    const wrapper = wrapperOf()!;
    expect(wrapper.getAttribute("data-state")).toBe("broken");
    expect(wrapper.textContent).toContain("unavailable");
    expect(wrapper.querySelector('[data-slot="docblocks/sync-embed-body"]')).toBeNull();

    // The restore's back stand: the master's undo of the removal re-creates
    // the same id (the consumer's doc keeps the ids stable) — the same
    // subscription stands the resolved over it.
    act(() => {
      master.undo();
    });
    expect(master.getBlock("m0003")).not.toBeNull();
    expect(wrapperOf()!.getAttribute("data-state")).toBe("resolved");
    expect(wrapperOf()!.querySelector('[data-slot="docblocks/sync-embed-body"]')).not.toBeNull();
  });

  it("a full-doc ref resolves: the master content renders inside, not in the outer list", () => {
    renderOuter({ docId: "master-1" });

    const wrapper = wrapperOf()!;
    expect(wrapper.getAttribute("data-state")).toBe("resolved");
    expect(wrapper.textContent).toContain(MASTER_HEADING);
    expect(wrapper.textContent).toContain(MASTER_P3);

    // The master's content is not in the outer block list: the blocks
    // rendered outside the wrapper are the outer doc's own only.
    const outerHeadings = Array.from(
      document.querySelectorAll<HTMLElement>('[data-block-type="heading"]:not([data-slot="docblocks/row"])')
    ).filter((el) => !wrapper.contains(el));
    const outerParagraphs = Array.from(
      document.querySelectorAll<HTMLElement>('[data-block-type="paragraph"]:not([data-slot="docblocks/row"])')
    ).filter((el) => !wrapper.contains(el));
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

    const wrappers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-block-type="sync-embed"]:not([data-slot="docblocks/row"])')
    );
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

    const wrappers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-block-type="sync-embed"]:not([data-slot="docblocks/row"])')
    );
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
