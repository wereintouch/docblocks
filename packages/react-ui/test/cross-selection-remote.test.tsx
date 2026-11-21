// @vitest-environment jsdom
// The endpoint's block's remote's change over the cross's selection: the
// remote's insert's rebase (the start / the end's endpoint) and the
// remote's mark's re-establish (the runs' in-place's re-render).
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { flushFrames, renderDoc, selectAcross, textNodeOf, wrapperOf } from "./cross-selection.helpers";

describe("the endpoint block's remote change (the cross selection's stand)", () => {
  // The rebuild of the endpoint block's text detaches the selection's
  // local-end nodes (the browser drops the cross selection over them —
  // the stale view stand). The capture over the store subscription (the
  // DOM intact) stands the re-establish: the local end rebases across the
  // delta, the far end stands by its node.
  it("the remote's insert over the start endpoint rebases the cross range (the selection stands)", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta gamma");
    });

    // The cross selection: p1[2..5] ("pha") over p2[0..4] ("beta").
    selectAcross(p1, 2, p2, 4);
    // The peer's insert at p1's start (the remote change over the start
    // endpoint — the rebuild detaches the selection's nodes).
    act(() => {
      doc.insertText(p1, 0, "XX");
    });
    await flushFrames();

    // The cross selection stands, the start endpoint rebased over the
    // delta (2 → 4 over the inserted "XX").
    const range = window.getSelection()!.getRangeAt(0);
    const p1Node = textNodeOf(p1);
    expect(range.startContainer).toBe(p1Node);
    expect(range.startOffset).toBe(4);
    expect(range.endContainer).toBe(textNodeOf(p2));
    expect(range.endOffset).toBe(4);
  });

  it("the remote's insert over the end endpoint rebases the far end (the selection stands)", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta gamma");
    });

    selectAcross(p1, 2, p2, 4);
    // The peer's insert at p2's start (the end endpoint's block).
    act(() => {
      doc.insertText(p2, 0, "X");
    });
    await flushFrames();

    const range = window.getSelection()!.getRangeAt(0);
    expect(range.startContainer).toBe(textNodeOf(p1));
    expect(range.startOffset).toBe(2);
    expect(range.endContainer).toBe(textNodeOf(p2));
    expect(range.endOffset).toBe(5);
  });

  it("the remote's mark over the endpoint's segment re-establishes the cross range (the runs' in-place re-render)", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta gamma");
    });

    selectAcross(p1, 2, p2, 4);
    // The peer's bold over p1[1..4) (the mark/attrs-only change: the runs
    // re-render in place — the local end's nodes detach over the same
    // text).
    act(() => {
      doc.setMark(p1, 1, 3, { type: "bold" });
    });
    await flushFrames();

    // The cross selection stands at the same offsets: p1's rebuilt runs
    // carry the flat offset 2 in the bold segment ("lph"), p2 stands.
    const range = window.getSelection()!.getRangeAt(0);
    const bold = wrapperOf(p1).querySelector<HTMLElement>("strong");
    expect(bold).not.toBeNull();
    expect(range.startContainer).toBe(bold!.firstChild);
    expect(range.startOffset).toBe(1);
    expect(range.endContainer).toBe(textNodeOf(p2));
    expect(range.endOffset).toBe(4);
  });
});
