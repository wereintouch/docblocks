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

  it("renders the caption line while the caption attr is non-empty", () => {
    renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code", { caption: "The figure" }), 0, "x");
    });
    const caption = document.querySelector<HTMLInputElement>("[data-slot='docblocks/code-caption']");
    expect(caption, "the caption line should stand").not.toBeNull();
    expect(caption!.value).toBe("The figure");
    expect(caption!.className).toContain("text-center");
    // The line sits below the block (a sibling of the wrapper, not inside it).
    const wrapper = document.querySelector<HTMLElement>("[data-block-type='code']");
    expect(wrapper!.contains(caption)).toBe(false);
  });

  it("shows the caption line on the button press and removes it on the empty blur", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code");
      d.insertText(code, 0, "x");
    });
    expect(document.querySelector("[data-slot='docblocks/code-caption']")).toBeNull();

    const button = document.querySelector<HTMLElement>("[data-slot='docblocks/code-caption-toggle']");
    act(() => {
      fireEvent.click(button as Element);
    });
    let line = document.querySelector<HTMLInputElement>("[data-slot='docblocks/code-caption']");
    expect(line, "the caption line should appear").not.toBeNull();
    expect(line!.value).toBe("");

    act(() => {
      fireEvent.change(line as Element, { target: { value: "Fig." } });
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { caption: "Fig." } });

    // Wiping the line to the empty string writes the empty caption (the
    // removed state); the blur then unmounts the empty line.
    line = document.querySelector("[data-slot='docblocks/code-caption']") as HTMLInputElement;
    act(() => {
      fireEvent.change(line, { target: { value: "" } });
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { caption: "" } });
    act(() => {
      fireEvent.blur(line);
    });
    expect(document.querySelector("[data-slot='docblocks/code-caption']")).toBeNull();
  });

  it("does not re-seat the caret on an unrelated re-render after a mounted press (no laggard flag)", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code", { caption: "Figure" });
      d.insertText(code, 0, "x");
    });
    const line = document.querySelector<HTMLInputElement>("[data-slot='docblocks/code-caption']");
    expect(line).not.toBeNull();
    const button = document.querySelector<HTMLElement>("[data-slot='docblocks/code-caption-toggle']");
    // The line is shown by the non-empty caption; focusing it sets the
    // local state, so the following press takes the already-mounted path.
    act(() => {
      fireEvent.focus(line as Element);
    });
    line!.setSelectionRange(2, 2);
    act(() => {
      fireEvent.click(button as Element);
    });
    // The press on the mounted line seats directly (the caret at the end).
    expect(line!.selectionEnd).toBe(line!.value.length);
    // The user moves the caret back to the middle. An unrelated re-render
    // must not consume a laggard seat flag (the old unconditional flag-set
    // re-seated the caret to the end on that render).
    line!.setSelectionRange(2, 2);
    act(() => {
      doc.updateBlock(code, { wrap: false });
    });
    expect(line!.selectionStart).toBe(2);
    expect(line!.selectionEnd).toBe(2);
  });

  it("keeps a mid-caption caret across a store re-render (the seat is one-shot)", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code", { caption: "Figure" });
      d.insertText(code, 0, "x");
    });
    const line = document.querySelector<HTMLInputElement>("[data-slot='docblocks/code-caption']");
    expect(line).not.toBeNull();
    line!.focus();
    line!.setSelectionRange(3, 3); // a mid-line caret (not the end)
    // A store re-render (an unrelated attr write) must not re-seat the caret.
    act(() => {
      doc.updateBlock(code, { wrap: false });
    });
    expect(document.activeElement).toBe(line);
    expect(line!.selectionStart).toBe(3);
    expect(line!.selectionEnd).toBe(3);
  });

  it("re-seats the caret at the end on the button press (a mid-line caret)", () => {
    let code: BlockId = "";
    renderCodeDoc((d) => {
      code = d.insertBlock("code", { caption: "Figure" });
      d.insertText(code, 0, "x");
    });
    const line = document.querySelector<HTMLInputElement>("[data-slot='docblocks/code-caption']");
    line!.focus();
    line!.setSelectionRange(2, 2);
    const button = document.querySelector<HTMLElement>("[data-slot='docblocks/code-caption-toggle']");
    act(() => {
      fireEvent.click(button as Element);
    });
    expect(document.activeElement).toBe(line);
    expect(line!.selectionEnd).toBe(line!.value.length);
  });

  it("seats the caret in the pressing pane's input (the per-editor registry)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    doc.insertText(doc.insertBlock("code", { caption: "Fig" }), 0, "x");
    // Two editors over the SAME doc in one document (the playground's panes):
    // the button press must reach the input of the pane it stands in.
    const paneA = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const paneB = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const buttonA = paneA.container.querySelector<HTMLElement>("[data-slot='docblocks/code-caption-toggle']");
    expect(buttonA, "pane A's caption button should be present").not.toBeNull();
    act(() => {
      buttonA!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const active = document.activeElement;
    expect(active, "the caption input should hold the focus").not.toBeNull();
    expect(paneA.container.contains(active)).toBe(true);
    expect(paneB.container.contains(active)).toBe(false);
    paneA.unmount();
    paneB.unmount();
  });
});
