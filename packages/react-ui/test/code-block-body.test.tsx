// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-14T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

function renderCodeDoc(prepare: (doc: TestDoc) => void): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

describe("the code block body", () => {
  afterEach(cleanup);

  it("renders one line number per logical line (the line-break count + 1)", () => {
    renderCodeDoc((d) => d.insertText(d.insertBlock("code"), 0, "a\nb\nc"));
    const track = document.querySelector<HTMLElement>("[data-slot='docblocks/code-line-numbers']");
    expect(track, "the line-number track should be present").not.toBeNull();
    // jsdom cannot measure line boxes: the static stack (one div per line).
    const numbers = [...track!.querySelectorAll("div")].map((el) => el.textContent);
    expect(numbers).toEqual(["1", "2", "3"]);
  });

  it("hides the numbers when the lineNumbers attr is off", () => {
    renderCodeDoc((d) => d.insertText(d.insertBlock("code", { lineNumbers: false }), 0, "a"));
    expect(document.querySelector("[data-slot='docblocks/code-line-numbers']")).toBeNull();
  });

  it("renders one empty line (number one) for the empty block", () => {
    renderCodeDoc((d) => d.insertBlock("code"));
    const track = document.querySelector<HTMLElement>("[data-slot='docblocks/code-line-numbers']");
    expect(track).not.toBeNull();
    expect([...track!.querySelectorAll("div")].map((el) => el.textContent)).toEqual(["1"]);
    // The zero-width line box of the empty editable (the caret target) is
    // a structural CSS rule (the :empty::after zero-width space), not a
    // class — the inner stands empty and unstyled by a utility here.
    const inner = document.querySelector<HTMLElement>("[data-slot='docblocks/block-content']");
    expect(inner!.textContent).toBe("");
    expect(inner!.className).not.toContain("content-");
  });

  it("does not show the slash-menu placeholder (code keeps the '/' as plain text)", () => {
    renderCodeDoc((d) => {
      d.insertBlock("paragraph"); // the paragraph keeps the hint
      d.insertBlock("code");
    });
    const inners = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='docblocks/block-content']"));
    const codeInner = inners.find((el) => el.closest("pre") !== null);
    const paragraphInner = inners.find((el) => el.closest("pre") === null);
    expect(codeInner?.getAttribute("data-placeholder")).toBeNull();
    expect(paragraphInner?.getAttribute("data-placeholder")).toBe("Type '/' for commands");
  });

  it("wraps long lines by default and scrolls horizontally when wrap is off", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code");
      d.insertText(code, 0, "x".repeat(80));
    });
    let inner = document.querySelector<HTMLElement>("[data-slot='docblocks/block-content']");
    let scroll = document.querySelector<HTMLElement>("[data-slot='docblocks/code-scroll']");
    expect(inner!.className).toContain("whitespace-pre-wrap");
    expect(scroll!.className).not.toContain("overflow-x-auto");
    act(() => {
      doc.updateBlock(code, { wrap: false });
    });
    inner = document.querySelector("[data-slot='docblocks/block-content']") as HTMLElement;
    scroll = document.querySelector("[data-slot='docblocks/code-scroll']") as HTMLElement;
    // The wrap class is replaced, not stacked (the substring "whitespace-pre"
    // would also match "whitespace-pre-wrap").
    expect(inner.className).not.toContain("whitespace-pre-wrap");
    expect(inner.className).toContain("whitespace-pre");
    expect(scroll.className).toContain("overflow-x-auto");
  });

  it("clamps the body to the 5 line boxes with the fade while collapsed", () => {
    const text = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\n");
    renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code", { collapsed: true }), 0, text);
    });
    const body = document.querySelector<HTMLElement>("[data-slot='docblocks/code-body']");
    expect(body, "the code body should be present").not.toBeNull();
    expect(body!.style.maxHeight).toBe("calc(5 * var(--docblocks-line-box-height))");
    expect(body!.style.overflow).toBe("hidden");
    expect(body!.style.maskImage).toContain("var(--docblocks-line-box-height)");
    // Expanded (the absent attr): no clamp.
  });

  it("expands and collapses from the header button (one updateBlock, disabled at five lines)", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code");
      d.insertText(code, 0, Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\n"));
    });
    const toggle = () => document.querySelector<HTMLButtonElement>("[data-slot='docblocks/code-collapse']");
    expect(toggle()!.disabled).toBe(false);
    act(() => {
      fireEvent.click(toggle() as Element);
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { collapsed: true } });
    const body = document.querySelector<HTMLElement>("[data-slot='docblocks/code-body']");
    expect(body!.style.maxHeight).toBe("calc(5 * var(--docblocks-line-box-height))");
    act(() => {
      fireEvent.click(toggle() as Element);
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { collapsed: false } });
    expect((document.querySelector("[data-slot='docblocks/code-body']") as HTMLElement).style.maxHeight).toBe("");

    // Five logical lines: the collapse would hide nothing — disabled.
    const doc5 = renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code"), 0, Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n"));
    });
    void doc5;
    // The second block's toggle stands in the same document tree.
    const toggles = document.querySelectorAll<HTMLButtonElement>("[data-slot='docblocks/code-collapse']");
    expect(toggles.length).toBe(2);
    expect(toggles[1]!.disabled).toBe(true);

    // A COLLAPSED block is always expandable, even at ≤5 logical lines
    // (the clamp may still hide wrapped line boxes — the button must not
    // strand the user collapsed).
    const doc6 = renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code", { collapsed: true }), 0, "line one\nline two");
    });
    void doc6;
    const togglesAll = document.querySelectorAll<HTMLButtonElement>("[data-slot='docblocks/code-collapse']");
    expect(togglesAll.length).toBe(3);
    expect(togglesAll[2]!.disabled).toBe(false);
  });
});
