// @vitest-environment jsdom
/**
 * The link popover's component behavior: the prefill's stand, the commit's
 * write (the mark over the target's range), the invalid's stand (the no-
 * write + the open's stand), the removal's write, and the Escape's
 * no-write's close.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act, createRef } from "react";

import { type Doc, createDoc } from "docblocks-core";

import { EditorProvider } from "../src";
import { LinkPopover, type LinkPopoverState } from "../src/editing/link";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

interface Fixture {
  doc: Doc;
  blockId: string;
  state: LinkPopoverState;
  closes: string[];
}

function fixture(linked: boolean): Fixture {
  const doc = createDoc({ id: "link-popover-doc", createdAt: CREATED_AT });
  const blockId = doc.insertBlock("paragraph");
  doc.insertText(blockId, 0, "hello world");
  if (linked) doc.setMark(blockId, 6, 11, { type: "link", href: "https://old.example" });
  const state: LinkPopoverState = {
    anchor: { x: 0, y: 0 },
    target: { kind: "single", blockId, from: 6, to: 11 },
    prefilledHref: linked ? "https://old.example" : null,
  };
  return { doc, blockId, state, closes: [] };
}

function renderPopover(f: Fixture) {
  const rootRef = createRef<HTMLDivElement>();
  render(
    <EditorProvider doc={f.doc}>
      <div ref={rootRef} />
      <LinkPopover rootRef={rootRef} state={f.state} onClose={() => f.closes.push("close")} />
    </EditorProvider>
  );
}

function pressEnter(input: HTMLElement) {
  act(() => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

afterEach(cleanup);

describe("LinkPopover", () => {
  it("prefills the uniform href and commits the new address on submit", () => {
    const f = fixture(true);
    renderPopover(f);

    const input = screen.getByPlaceholderText("Paste or type a link address") as HTMLInputElement;
    expect(input.value).toBe("https://old.example");

    fireEvent.change(input, { target: { value: "https://new.example" } });
    pressEnter(input);

    expect(f.doc.getRuns(f.blockId)).toEqual([
      { text: "hello ", marks: {} },
      { text: "world", marks: { link: { href: "https://new.example" } } },
    ]);
    expect(f.closes).toEqual(["close"]);
  });

  it("the no-href's prefill's stand: the input stands empty", () => {
    const f = fixture(false);
    renderPopover(f);
    const input = screen.getByPlaceholderText("Paste or type a link address") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("the invalid's stand: the error stands, the doc's write stands off", () => {
    const f = fixture(false);
    renderPopover(f);

    const input = screen.getByPlaceholderText("Paste or type a link address") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "not a link at all!!!" } });
    pressEnter(input);
    expect(screen.getByText("Invalid link address")).toBeTruthy();

    expect(f.closes).toEqual([]); // the open's stand over the invalid's submit
    expect(f.doc.getRuns(f.blockId)).toEqual([{ text: "hello world", marks: {} }]);
  });

  it("the removal stands the unmark (one write, the text's stand)", () => {
    const f = fixture(true);
    renderPopover(f);

    act(() => {
      screen.getByRole("button", { name: "Remove link" }).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(f.doc.getRuns(f.blockId)).toEqual([{ text: "hello world", marks: {} }]);
    expect(f.closes).toEqual(["close"]);
  });

  it("the Escape's stand: the close over the no-write", () => {
    const f = fixture(false);
    renderPopover(f);

    const input = screen.getByPlaceholderText("Paste or type a link address") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://draft.example" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(f.closes).toEqual(["close"]);
    expect(f.doc.getRuns(f.blockId)).toEqual([{ text: "hello world", marks: {} }]);
  });
});
