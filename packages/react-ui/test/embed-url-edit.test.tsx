// @vitest-environment jsdom
// The embed's url edit (the toolbar's edit affordance — the panel's open /
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** Seed the doc, then render provider + editor. */
function renderDoc(
  prepare: (doc: TestDoc) => void,
  options?: {
    blockRenderers?: BlockRendererMap;
    embedSandbox?: (src: string) => string | null;
    mode?: "edit" | "view" | "published";
  }
) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider
      doc={doc}
      blockRenderers={options?.blockRenderers}
      embedSandbox={options?.embedSandbox}
      mode={options?.mode}
    >
      <Editor />
    </EditorProvider>
  );
  return doc;
}

afterEach(() => {
  cleanup();
});

describe("embed url edit (the toolbar's edit affordance)", () => {
  const EDIT_BUTTON_SELECTOR = '[data-slot="docblocks/embed-edit-url"]';
  const PANEL_SELECTOR = '[data-slot="docblocks/embed-edit"]';
  const INPUT_SELECTOR = "[data-slot='docblocks/embed-edit-input']";
  const SAVE_SELECTOR = "[data-slot='docblocks/embed-edit-save']";
  const CANCEL_SELECTOR = "[data-slot='docblocks/embed-edit-cancel']";
  const HINT_SELECTOR = "[data-slot='docblocks/embed-edit-hint']";
  const SRC = "https://example.com/page";

  function renderEmbed() {
    const doc = renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: SRC }));
    return { doc, embedId: doc.getChildren(doc.toJSON().id)[0]! };
  }

  it("the edit button stands over the edit mode (the editing surface); absent over the view mode", () => {
    renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: SRC }));
    const button = document.querySelector(EDIT_BUTTON_SELECTOR);
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Edit URL");
    // The panel stands closed until the button's click.
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();

    cleanup();
    renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: SRC }), { mode: "view" });
    expect(document.querySelector(EDIT_BUTTON_SELECTOR)).toBeNull();
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
  });

  it("the edit's open pre-fills the input with the current src (the focus's stand)", async () => {
    renderEmbed();
    const button = document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!;

    await act(async () => {
      fireEvent.click(button);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR);
    expect(input).not.toBeNull();
    expect(input!.value).toBe(SRC);
    // The keyboard's flow: the input's focused when the panel stands.
    expect(input).toBe(document.activeElement);
  });

  it("the commit's Enter writes the new src (the iframe's navigation, the panel's close)", async () => {
    const { doc, embedId } = renderEmbed();
    const button = document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!;

    await act(async () => {
      fireEvent.click(button);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://other.example/app" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    // The doc's write: the `src`'s new value, the kind's untouched.
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { kind: "iframe", src: "https://other.example/app" } });
    // The iframe's navigation: the new src over the attr.
    const iframe = document.querySelector<HTMLIFrameElement>("[data-slot='docblocks/embed']");
    expect(iframe?.getAttribute("src")).toBe("https://other.example/app");
    // The panel's closed over the commit.
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
  });

  it("the Escape's cancel closes the panel (the src's untouched)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://other.example/app" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
  });

  it("the cancel's button closes the panel (the src's untouched)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(CANCEL_SELECTOR)!);
    });
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
  });

  it("the unsafe's draft stands the hint + the save's no-commit (the slash form's rule)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    });
    // The hint's stand over the unsafe's scheme, the save's disabled.
    expect(document.querySelector(HINT_SELECTOR)).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>(SAVE_SELECTOR)!.disabled).toBe(true);
    await act(async () => {
      fireEvent.keyDown(document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!, { key: "Enter" });
    });
    // The no-commit: the src's untouched, the panel's open (the fix's chance).
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
    expect(document.querySelector(PANEL_SELECTOR)).not.toBeNull();
  });

  it("the empty's draft stands the save's disabled (the no-commit)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "   " } });
    });
    expect(document.querySelector<HTMLButtonElement>(SAVE_SELECTOR)!.disabled).toBe(true);
    await act(async () => {
      fireEvent.keyDown(document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!, { key: "Enter" });
    });
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
  });

  it("the unchanged's draft writes nothing (the no-op's stand)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      // Trim the pre-fill: the whitespace's trim lands the unchanged's src.
      fireEvent.change(input, { target: { value: `${SRC}  ` } });
      fireEvent.click(document.querySelector<HTMLButtonElement>(SAVE_SELECTOR)!);
    });
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
  });
});
