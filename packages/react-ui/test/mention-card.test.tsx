// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { MentionMark } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import type { MentionInteractions } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

const CARD_HOST = '[data-slot="docblocks/mention-card"]';
const CHIP_SELECTOR = '[data-slot="docblocks/mention"]';
const EDITOR_ROOT = '[data-slot="docblocks/editor"]';

const HOVER_OPEN_MS = 400;

interface Harness {
  doc: TestDoc;
  blockId: string;
}

function renderChip(prepare?: (doc: TestDoc, blockId: string) => void): Harness {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const blockId = doc.insertBlock("paragraph");
  doc.insertText(blockId, 0, "Hello Jane");
  doc.setMark(blockId, 6, 10, { type: "mention", kind: "user", id: "u1", label: "Jane" });
  if (prepare !== undefined) prepare(doc, blockId);
  render(
    <EditorProvider
      doc={doc}
      mentionInteractions={{
        renderCard: (mention) => <div data-testid="demo-card">Card {mention.id}</div>,
        onClick: () => {},
      }}
    >
      <Editor />
    </EditorProvider>
  );
  return { doc, blockId };
}

function renderChipWith(interactions: MentionInteractions, options?: { mode?: "edit" | "view" }): Harness {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const blockId = doc.insertBlock("paragraph");
  doc.insertText(blockId, 0, "Hello Jane");
  doc.setMark(blockId, 6, 10, { type: "mention", kind: "user", id: "u1", label: "Jane" });
  render(
    <EditorProvider doc={doc} mentionInteractions={interactions} mode={options?.mode}>
      <Editor />
    </EditorProvider>
  );
  return { doc, blockId };
}

async function hoverChip(chip: HTMLElement) {
  vi.useFakeTimers();
  try {
    fireEvent.pointerOver(chip);
    await act(async () => {
      vi.advanceTimersByTime(HOVER_OPEN_MS + 50);
    });
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the mention hover card", () => {
  it("stands the consumer's card over the hover (the target's fields, the host's attrs)", async () => {
    renderChip();
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR);
    expect(chip).not.toBeNull();

    await hoverChip(chip!);

    const host = document.querySelector<HTMLElement>(CARD_HOST);
    expect(host).not.toBeNull();
    expect(host!.textContent).toBe("Card u1");
    expect(host!.getAttribute("data-mention-kind")).toBe("user");
    expect(host!.getAttribute("data-mention-id")).toBe("u1");
    expect(host!.getAttribute("aria-hidden")).toBe("true");
    expect(window.getComputedStyle(host!).position).toBe("fixed");
  });

  it("stands no card before the open's delay (and the card over it)", async () => {
    renderChip();
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;
    const root = document.querySelector<HTMLElement>(EDITOR_ROOT)!;

    vi.useFakeTimers();
    try {
      fireEvent.pointerOver(chip);
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(document.querySelector(CARD_HOST)).toBeNull();
      // The exit's grace: a same-tick re-entry stands the pending (no
      // close is running yet); the open's delay completes.
      await act(async () => {
        vi.advanceTimersByTime(150);
      });
      expect(document.querySelector(CARD_HOST)).not.toBeNull();
      // The exit's grace closes the card (the pointer left the zone).
      fireEvent.pointerOver(root);
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(document.querySelector(CARD_HOST)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a re-entry over the chip cancels the exit's grace (the card stands)", async () => {
    renderChip();
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;
    const root = document.querySelector<HTMLElement>(EDITOR_ROOT)!;

    await hoverChip(chip);
    expect(document.querySelector(CARD_HOST)).not.toBeNull();

    vi.useFakeTimers();
    try {
      // The exit starts the grace; the re-entry over the chip cancels it
      // before the fire.
      fireEvent.pointerOver(root);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.pointerOver(chip);
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(document.querySelector(CARD_HOST)).not.toBeNull();
      // The final exit closes (the grace stands no re-entry this time).
      fireEvent.pointerOver(root);
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(document.querySelector(CARD_HOST)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the `renderCard`'s null stands no host", async () => {
    renderChipWith({ renderCard: () => null });
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;

    await hoverChip(chip);

    expect(document.querySelector(CARD_HOST)).toBeNull();
  });

  it("a chip switch before the open's delay stands the new chip's card only", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const blockId = doc.insertBlock("paragraph");
    doc.insertText(blockId, 0, "Jane met Spec");
    doc.setMark(blockId, 0, 4, { type: "mention", kind: "user", id: "u1", label: "Jane" });
    doc.setMark(blockId, 9, 13, { type: "mention", kind: "doc", id: "d1", label: "Spec" });
    render(
      <EditorProvider
        doc={doc}
        mentionInteractions={{
          renderCard: (mention) => <div data-testid="demo-card">Card {mention.id}</div>,
          onClick: () => {},
        }}
      >
        <Editor />
      </EditorProvider>
    );
    const chips = document.querySelectorAll<HTMLElement>(CHIP_SELECTOR);
    expect(chips.length).toBe(2);
    const [chipA, chipB] = chips as unknown as [HTMLElement, HTMLElement];

    // The hover enters chip A (the open's delay starts), then moves over
    // chip B before the delay stands — A's pending must not fire.
    vi.useFakeTimers();
    try {
      fireEvent.pointerOver(chipA);
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      fireEvent.pointerOver(chipB);
      await act(async () => {
        vi.advanceTimersByTime(HOVER_OPEN_MS + 50);
      });
    } finally {
      vi.useRealTimers();
    }

    const host = document.querySelector<HTMLElement>(CARD_HOST);
    expect(host).not.toBeNull();
    expect(host!.getAttribute("data-mention-id")).toBe("d1");
    expect(host!.textContent).toBe("Card d1");
  });

  it("the Escape closes the card", async () => {
    renderChip();
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;

    await hoverChip(chip);
    expect(document.querySelector(CARD_HOST)).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(CARD_HOST)).toBeNull();
  });
});

describe("the mention card's click", () => {
  it("stands the delivery (the target's mark + the native event, no preventDefault's stand)", async () => {
    const onClick = vi.fn();
    renderChipWith({
      renderCard: (mention: MentionMark) => <div>Card {mention.id}</div>,
      onClick,
    });
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;

    fireEvent.click(chip);

    expect(onClick).toHaveBeenCalledOnce();
    const [target, event] = onClick.mock.calls[0] as [MentionMark, MouseEvent];
    expect(target).toEqual({ kind: "user", id: "u1", label: "Jane" });
    expect(event.defaultPrevented).toBe(false);
  });

  it("the click stands no card (the click's stand is the consumer's)", async () => {
    renderChip();
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;

    fireEvent.click(chip);
    expect(document.querySelector(CARD_HOST)).toBeNull();
  });
});

describe("the mention card's lifecycle", () => {
  it("a doc's change that removes the anchor chip closes the card", async () => {
    const { doc, blockId } = renderChip();
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;

    await hoverChip(chip);
    expect(document.querySelector(CARD_HOST)).not.toBeNull();

    // The text's edit re-renders the chip (a fresh element) — the anchor's
    // stand is detached over it, and the change tick's re-check closes.
    await act(async () => {
      doc.insertText(blockId, 0, "X");
    });
    expect(chip.isConnected).toBe(false);
    expect(document.querySelector(CARD_HOST)).toBeNull();
  });

  it("the read-only's stand stands the card too (the view mode's parity)", async () => {
    renderChipWith({ renderCard: (mention: MentionMark) => <div>Card {mention.id}</div> }, { mode: "view" });
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR);
    expect(chip).not.toBeNull();

    await hoverChip(chip!);

    expect(document.querySelector(CARD_HOST)).not.toBeNull();
  });
});
