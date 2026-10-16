// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { measureCodeLines } from "../src/blocks/code-metrics";

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

/** The code block's header row. */
function headerOf(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="docblocks/code-header"]');
  expect(el, "the code header should be present").not.toBeNull();
  return el!;
}

function languageButton(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="docblocks/code-language"]');
  expect(el, "the language button should be present").not.toBeNull();
  return el!;
}

/** Open the language popover (the radix popover trigger toggles on click). */
function openLanguageMenu(): void {
  act(() => {
    fireEvent.click(languageButton());
  });
  const menu = document.querySelector<HTMLElement>('[data-slot="docblocks/code-language-menu"]');
  expect(menu, "the language menu should be open").not.toBeNull();
}

describe("the code block header", () => {
  afterEach(cleanup);

  it("renders the header with the default Plain Text label and the controls", () => {
    const doc = renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code"), 0, "const x = 1;");
    });
    void doc;
    const header = headerOf();
    expect(languageButton().textContent).toContain("Plain Text");
    expect(header.querySelector('[data-slot="docblocks/code-copy"]')).not.toBeNull();
    expect(header.querySelector('[data-slot="docblocks/code-more"]')).not.toBeNull();
    // The strip-reveal contract: the row's border stands only while the
    // wrapper is hovered or focused (typing); the default is transparent.
    expect(header.className).toContain("border-transparent");
    expect(header.className).toContain("group-hover:border-border");
    expect(header.className).toContain("group-focus-within:border-border");
    // The hover-reveal contract: the controls are invisible (and unclickable)
    // until the wrapper is hovered (the left group — the language button and
    // the center slot — and the actions group each carry the reveal classes).
    const actions = header.querySelector('[data-slot="docblocks/code-header-actions"]') as HTMLElement;
    expect(actions.className).toContain("opacity-0");
    expect(actions.className).toContain("group-hover:opacity-100");
    const langGroup = languageButton().parentElement as HTMLElement;
    expect(langGroup.className).toContain("opacity-0");
    expect(langGroup.className).toContain("group-hover:opacity-100");
  });

  it("keeps the header controls visible while a header menu stands open (the portaled menus lose the block hover)", () => {
    renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code"), 0, "const x = 1;");
    });
    const header = headerOf();
    const actions = header.querySelector('[data-slot="docblocks/code-header-actions"]') as HTMLElement;
    const langGroup = languageButton().parentElement as HTMLElement;
    // Closed: the hover reveal hides both groups.
    expect(actions.className).toContain("opacity-0");
    expect(langGroup.className).toContain("opacity-0");
    // The "more" menu open (the radix dropdown trigger toggles on
    // pointerdown): the pointer over the portaled menu loses the block
    // hover — the controls and the row's strip stay visible.
    act(() => {
      fireEvent.pointerDown(header.querySelector('[data-slot="docblocks/code-more"]') as Element);
    });
    expect(
      document.querySelector('[data-slot="docblocks/code-more-menu"]'),
      "the more menu should be open"
    ).not.toBeNull();
    expect(actions.className).toContain("opacity-100");
    expect(langGroup.className).toContain("opacity-100");
    expect(header.className).toContain("border-border");
    // The language popover keeps them visible too.
    act(() => {
      fireEvent.click(languageButton());
    });
    expect(
      document.querySelector('[data-slot="docblocks/code-language-menu"]'),
      "the language menu should be open"
    ).not.toBeNull();
    expect(actions.className).toContain("opacity-100");
  });

  it("shows the block's language as the label", () => {
    const doc = renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code", { language: "python" }), 0, "print(1)");
    });
    void doc;
    expect(languageButton().textContent).toContain("Python");
  });

  it("shows an unknown language value as-is (the lenient reader posture)", () => {
    const doc = renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code", { language: "v" }), 0, "x");
    });
    void doc;
    expect(languageButton().textContent).toContain("v");
  });

  it("picks a language by clicking the list entry (one updateBlock)", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code");
      d.insertText(code, 0, "const x = 1;");
    });
    openLanguageMenu();
    const item = document.querySelector<HTMLElement>('[data-lang-value="rust"]');
    expect(item, "the Rust entry should be present").not.toBeNull();
    act(() => {
      (item as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { language: "rust" } });
    expect(languageButton().textContent).toContain("Rust");
    // The menu closed after the pick.
    expect(document.querySelector('[data-slot="docblocks/code-language-menu"]')).toBeNull();
  });

  it("filters the list on the search query and picks the first match on Enter", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code");
      d.insertText(code, 0, "x");
    });
    openLanguageMenu();
    const search = document.querySelector<HTMLElement>('[data-slot="docblocks/code-language-search"]');
    expect(search, "the search field should be present").not.toBeNull();
    act(() => {
      fireEvent.change(search as Element, { target: { value: "pyt" } });
    });
    // Only "Python" matches "pyt".
    expect(document.querySelector('[data-lang-value="python"]')).not.toBeNull();
    expect(document.querySelector('[data-lang-value="rust"]')).toBeNull();
    act(() => {
      fireEvent.keyDown(search as Element, { key: "Enter" });
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { language: "python" } });
    expect(document.querySelector('[data-slot="docblocks/code-language-menu"]')).toBeNull();
  });

  it("selecting Plain Text writes the empty language (the highlight-off state)", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code", { language: "python" });
      d.insertText(code, 0, "print(1)");
    });
    openLanguageMenu();
    const plain = document.querySelector<HTMLElement>('[data-lang-value="plain"]');
    expect(plain, "the Plain Text entry should be present").not.toBeNull();
    act(() => {
      (plain as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { language: "" } });
    expect(languageButton().textContent).toContain("Plain Text");
  });

  it("copies the block's plain text (indentation stands) and shows the circle-check feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const doc = renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code"), 0, "if a:\n\tb()");
    });
    void doc;
    const copy = document.querySelector<HTMLElement>('[data-slot="docblocks/code-copy"]');
    expect(copy).not.toBeNull();
    act(() => {
      fireEvent.click(copy as Element);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="docblocks/code-copy"][data-copied="true"]')).not.toBeNull();
    });
    expect(writeText).toHaveBeenCalledWith("if a:\n\tb()");
  });

  it("toggles line numbers and wrap through the more menu (defaults ON, one updateBlock each)", () => {
    let code: BlockId = "";
    const doc = renderCodeDoc((d) => {
      code = d.insertBlock("code");
      d.insertText(code, 0, "x");
    });
    const more = headerOf().querySelector('[data-slot="docblocks/code-more"]');
    expect(more, "the more trigger should be present").not.toBeNull();
    // The radix dropdown trigger toggles on pointerdown.
    act(() => {
      fireEvent.pointerDown(more as Element);
    });
    const menu = document.querySelector<HTMLElement>('[data-slot="docblocks/code-more-menu"]');
    expect(menu, "the more menu should be open").not.toBeNull();

    const lineItem = menu!.querySelector('[data-code-option="lineNumbers"]') as HTMLElement;
    const wrapItem = menu!.querySelector('[data-code-option="wrap"]') as HTMLElement;
    // The absent attrs read as ON.
    expect(lineItem.getAttribute("data-state")).toBe("checked");
    expect(wrapItem.getAttribute("data-state")).toBe("checked");
    act(() => {
      lineItem.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { lineNumbers: false } });
    act(() => {
      wrapItem.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(doc.getBlock(code)).toMatchObject({ type: "code", attrs: { lineNumbers: false, wrap: false } });
  });
});

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
    // The zero-width line box of the empty editable (the caret target).
    const inner = document.querySelector<HTMLElement>("[data-slot='docblocks/block-content']");
    expect(inner!.className).toContain("empty:after:content-['\\200b']");
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

describe("measureCodeLines", () => {
  it("returns null without a measurable layout (the static fallback)", () => {
    const inner = document.createElement("div");
    inner.textContent = "a";
    document.body.appendChild(inner);
    // jsdom's computed line-height is "normal" (unparseable): the metric
    // is unavailable, the static stack stands.
    expect(measureCodeLines(inner, "a")).toBeNull();
  });

  it("measures the wrapped continuations into the logical line's height", () => {
    const inner = document.createElement("div");
    // line 0: "aa" (one visual line), line 1: "bccc" (two visual lines —
    // the wrap), line 2: "" (an empty line at the pitch).
    inner.textContent = "aa\nbccc\n";
    document.body.appendChild(inner);
    const innerRect = {
      top: 100,
      left: 0,
      right: 300,
      bottom: 177,
      width: 300,
      height: 77,
      x: 0,
      y: 100,
      toJSON: () => undefined,
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(innerRect as DOMRect);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ lineHeight: "25.6px" } as CSSStyleDeclaration);
    const rectAt = (dy: number) => new DOMRect(0, 100 + dy, 10, 18) as DOMRect;
    const original = Range.prototype.getClientRects?.bind(Range.prototype);
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: function (this: Range) {
        const text = this.toString();
        if (text === "aa") return [rectAt(0)] as DOMRect[];
        if (text === "bccc") return [rectAt(25.6), rectAt(51.2)] as DOMRect[];
        return [] as DOMRect[];
      },
      writable: true,
      configurable: true,
    });
    try {
      const metrics = measureCodeLines(inner, "aa\nbccc\n");
      // The tops are rounded to whole pixels (the dedup key) — the empty
      // line 3 stacks at the rounded pitch of the measured line 2.
      expect(metrics).toEqual([
        { top: 0, height: 25.6 },
        { top: 26, height: 51.2 },
        { top: 77.2, height: 25.6 },
      ]);
    } finally {
      if (original === undefined) {
        delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      } else {
        Object.defineProperty(Range.prototype, "getClientRects", {
          value: original,
          writable: true,
          configurable: true,
        });
      }
      vi.restoreAllMocks();
    }
  });
});
