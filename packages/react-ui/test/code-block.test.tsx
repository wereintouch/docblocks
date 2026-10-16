// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

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
    // until the wrapper is hovered (the language button and the actions
    // group each carry the reveal classes).
    const actions = header.querySelector('[data-slot="docblocks/code-header-actions"]') as HTMLElement;
    expect(actions.className).toContain("opacity-0");
    expect(actions.className).toContain("group-hover:opacity-100");
    const lang = header.querySelector('[data-slot="docblocks/code-language"]') as HTMLElement;
    expect(lang.className).toContain("opacity-0");
    expect(lang.className).toContain("group-hover:opacity-100");
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
