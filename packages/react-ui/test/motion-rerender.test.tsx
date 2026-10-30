// @vitest-environment jsdom
// The motion view's re-render contract (the performance ticket's P1/P2/P4):
// a text-only edit (a character, a mark) re-renders only the edited row's
// block view — the sibling rows' bodies stand (the row memo + the node
// interning + the per-block subscription), the row list's body (the
// Reorder.Group's) stands (the stamp and the stable props), and the
// presence overlay stands over zero peers. A structural change (an insert)
// re-renders the row list and stands the new row; the survivors' bodies
// stand (the interned node identities).
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

import type { BlockRendererProps } from "../src/blocks/renderers";
import { EditorProvider } from "../src/editor-provider";
import { MotionEditor } from "../src/motion/index";

const counters = vi.hoisted(() => ({ rowList: 0, presence: 0 }));

vi.mock("../src/motion/RowList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/motion/RowList")>();
  const Real = actual.RowList;
  return {
    RowList: (props: Parameters<typeof Real>[0]) => {
      counters.rowList += 1;
      return <Real {...props} />;
    },
  };
});

vi.mock("../src/presence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/presence")>();
  const Real = actual.PresenceCaretOverlay;
  return {
    PresenceCaretOverlay: (props: Parameters<typeof Real>[0]) => {
      counters.presence += 1;
      return <Real {...props} />;
    },
  };
});

const CREATED_AT = "2026-10-10T00:00:00.000Z";

function setup() {
  const doc = createDoc({ id: "rerender-doc", createdAt: CREATED_AT });
  const a = doc.insertBlock("paragraph");
  doc.insertText(a, 0, "alpha");
  const b = doc.insertBlock("paragraph");
  doc.insertText(b, 0, "beta");
  const c = doc.insertBlock("paragraph");
  doc.insertText(c, 0, "gamma");
  const seen: Record<string, number> = {};
  const paragraphRenderer = (props: BlockRendererProps) => {
    seen[props.id] = (seen[props.id] ?? 0) + 1;
    return <div data-testid="spy-paragraph">{props.id}</div>;
  };
  const utils = render(
    <EditorProvider doc={doc} blockRenderers={{ paragraph: paragraphRenderer }}>
      <MotionEditor />
    </EditorProvider>
  );
  return { doc, a, b, c, seen, utils };
}

describe("the motion re-render contract", () => {
  afterEach(() => {
    cleanup();
    counters.rowList = 0;
    counters.presence = 0;
  });

  it("stands the sibling rows' bodies on a character (the edited row stands)", () => {
    const { doc, a, b, c, seen } = setup();
    const beforeA = seen[a]!;
    const beforeB = seen[b]!;
    const beforeC = seen[c]!;
    const rowList = counters.rowList;
    const presence = counters.presence;

    act(() => {
      doc.insertText(a, 5, "x");
    });

    expect(seen[a]).toBe(beforeA + 1);
    expect(seen[b]).toBe(beforeB);
    expect(seen[c]).toBe(beforeC);
    // The row list's body stands (the stamp and the row keys are unchanged).
    expect(counters.rowList).toBe(rowList);
    // The presence overlay stands over zero peers (the blocks' wide read
    // skips itself).
    expect(counters.presence).toBe(presence);
  });

  it("stands the siblings on a mark change (the in-place rebuild contract)", () => {
    const { doc, a, b, c, seen } = setup();
    const beforeA = seen[a]!;
    const beforeB = seen[b]!;
    const beforeC = seen[c]!;
    const rowList = counters.rowList;

    act(() => {
      doc.setMark(a, 0, 5, { type: "bold" });
    });

    expect(seen[a]).toBe(beforeA + 1);
    expect(seen[b]).toBe(beforeB);
    expect(seen[c]).toBe(beforeC);
    expect(counters.rowList).toBe(rowList);
  });

  it("stands the row list and the survivors on a structural insert", () => {
    const { doc, a, b, c, seen } = setup();
    const beforeA = seen[a]!;
    const beforeB = seen[b]!;
    const beforeC = seen[c]!;
    const rowList = counters.rowList;

    act(() => {
      doc.insertBlock("paragraph");
    });

    // The row list's body stands (the order and the derivation moved).
    expect(counters.rowList).toBe(rowList + 1);
    // The survivors stand their bodies (the interned node identities).
    expect(seen[a]).toBe(beforeA);
    expect(seen[b]).toBe(beforeB);
    expect(seen[c]).toBe(beforeC);
  });
});
