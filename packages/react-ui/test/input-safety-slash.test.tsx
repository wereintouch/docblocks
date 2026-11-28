// @vitest-environment jsdom
// The slash's trigger over the page's text blocks (the `/`'s commit + the
// menu's open stand, the derived segment's parity, the code block's
// plain-text stand).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT } from "./input-safety.helpers";
import type { TestDoc } from "./input-safety.helpers";

describe("slash trigger (the page text blocks)", () => {
  let triggerId: BlockId = "";

  /** One text block of `kind` with `text`; `withSegment` adds a nested follower. An indented trigger needs a shallower head (the page sequence's jump rule). */
  function renderTrigger(
    kind: "paragraph" | "list-item" | "code",
    text: string,
    withSegment = false,
    indent = 0
  ): TestDoc {
    triggerId = "";
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    if (indent !== 0) doc.insertBlock("paragraph");
    const attrs: Record<string, unknown> = {};
    if (indent !== 0) attrs.indent = indent;
    if (kind === "list-item") attrs.list = "bullet";
    triggerId = doc.insertBlock(kind, Object.keys(attrs).length > 0 ? attrs : undefined);
    if (text !== "") doc.insertText(triggerId, 0, text);
    if (withSegment) {
      const child = doc.insertBlock("paragraph", { indent: indent + 1 });
      doc.insertText(child, 0, "nested");
    }
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    return doc;
  }

  /**
   * Seat a collapsed caret at `caretOffset` of the block's inner (on the
   * first text node; on the element for an empty inner) and press "/"; true
   * = the key's default was prevented (the editor commits the character —
   * the browser's insertion stands suppressed).
   */
  function pressSlash(wrapper: HTMLElement, inner: HTMLElement, caretOffset = 0): boolean {
    const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    if (textNode !== undefined) {
      range.setStart(textNode, caretOffset);
    } else {
      range.setStart(inner, 0);
    }
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    let prevented = false;
    act(() => {
      prevented = !wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
    });
    return prevented;
  }

  it("commits the / and opens the menu (the doc is the source of truth)", () => {
    const doc = renderTrigger("paragraph", "");
    const wrapper = document.querySelector<HTMLElement>(
      `[data-block-id="${triggerId}"]:not([data-slot="docblocks/row"])`
    );
    expect(wrapper, "the trigger should be rendered").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the trigger should carry the inner editable").not.toBeNull();

    const prevented = pressSlash(wrapper!, inner!);

    expect(prevented).toBe(true);
    // The "/" stands in the doc as a regular character (Backspace deletes it
    // like any other through the normal input path).
    expect(doc.getText(triggerId)).toBe("/");
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).not.toBeNull();
  });

  it("opens on a block that owns a derived segment (the apply never cascades)", () => {
    const doc = renderTrigger("paragraph", "", true);
    const wrapper = document.querySelector<HTMLElement>(
      `[data-block-id="${triggerId}"]:not([data-slot="docblocks/row"])`
    );
    expect(wrapper, "the trigger should be rendered").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the trigger should carry the inner editable").not.toBeNull();

    const prevented = pressSlash(wrapper!, inner!);

    expect(prevented).toBe(true);
    expect(doc.getText(triggerId)).toBe("/");
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).not.toBeNull();
  });

  it("opens on a non-empty, indented block (any position and indent of the page sequence)", () => {
    const doc = renderTrigger("list-item", "ab", false, 1);
    const wrapper = document.querySelector<HTMLElement>(
      `[data-block-id="${triggerId}"]:not([data-slot="docblocks/row"])`
    );
    expect(wrapper, "the trigger should be rendered").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the trigger should carry the inner editable").not.toBeNull();

    const prevented = pressSlash(wrapper!, inner!, 2);

    expect(prevented).toBe(true);
    expect(doc.getText(triggerId)).toBe("ab/");
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).not.toBeNull();
  });

  it("does not open on a code block (a / in code is plain text)", () => {
    const doc = renderTrigger("code", "ab");
    const wrapper = document.querySelector<HTMLElement>(
      `[data-block-id="${triggerId}"]:not([data-slot="docblocks/row"])`
    );
    expect(wrapper, "the trigger should be rendered").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the trigger should carry the inner editable").not.toBeNull();

    const prevented = pressSlash(wrapper!, inner!, 2);

    expect(prevented).toBe(false); // the character flows through the normal input path
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).toBeNull();
    expect(doc.getText(triggerId)).toBe("ab"); // jsdom inserts nothing; the browser would add the "/"
  });
});
