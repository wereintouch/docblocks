// @vitest-environment jsdom
// The editor-level's link open (the contenteditable's anchor's gap): the
// browser cancels the anchor's navigation default inside a CE, so the
// editor opens the href itself — the new tab's stand (the
// `window.open`'s `noopener,noreferrer`'s parity) over the edit and the
// view's modes (the parity), the editor's state untouched (the caret's
// seat is the mousedown's default — preserved), the press-drag (the
// selection's gesture) stands no open, the modified clicks and the
// non-left's buttons stand the browser's native stands, and the anchor's
// render stands the `rel`'s stand (the native open's security's parity).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
const HREF = "https://example.org/page";

function seedDoc(): { doc: ReturnType<typeof createDoc>; p: string } {
  const doc = createDoc({ id: "link-click-doc", createdAt: CREATED_AT });
  const p = doc.insertBlock("paragraph");
  doc.insertText(p, 0, "go to world now");
  doc.setMark(p, 6, 11, { type: "link", href: HREF }); // the "world"
  return { doc, p };
}

function renderDoc(doc: ReturnType<typeof createDoc>, mode: "edit" | "view" = "edit") {
  render(
    <EditorProvider doc={doc} mode={mode}>
      <Editor />
    </EditorProvider>
  );
  const link = screen.getByRole("link", { name: "world" });
  return { link };
}

describe("the link's click (the new tab's stand)", () => {
  beforeEach(() => {
    vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("the edit's mode: the plain click opens the new tab and stands the default's canceled (the navigation's off)", () => {
    const { doc, p } = seedDoc();
    const { link } = renderDoc(doc, "edit");

    act(() => {
      fireEvent.mouseDown(link, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.click(link, { clientX: 10, clientY: 10, button: 0 });
    });

    expect(window.open).toHaveBeenCalledWith(HREF, "_blank", "noopener,noreferrer");
    // The editor's state's stand (the text's, the no-write's stand).
    expect(doc.getText(p)).toBe("go to world now");
  });

  it("the anchor stands the rel's stand (the native open's security's parity)", () => {
    const { doc } = seedDoc();
    const { link } = renderDoc(doc);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toBe(HREF);
  });

  it("the view's mode stands the same open (the parity — the same-tab's carry-away's off)", () => {
    const { doc } = seedDoc();
    const { link } = renderDoc(doc, "view");

    act(() => {
      fireEvent.mouseDown(link, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.click(link, { clientX: 10, clientY: 10, button: 0 });
    });

    expect(window.open).toHaveBeenCalledWith(HREF, "_blank", "noopener,noreferrer");
  });

  it("the non-web's safe forms stand no new tab (the same-tab's navigation's stand — the mail client / the dialer / the page's stand)", () => {
    for (const href of ["mailto:help@example.com", "tel:+79161234567", "/docs/page"] as const) {
      const doc = createDoc({ id: `link-kind-${href}`, createdAt: CREATED_AT });
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "go to world now");
      doc.setMark(p, 6, 11, { type: "link", href }); // the "world"
      const { link } = renderDoc(doc);
      act(() => {
        fireEvent.mouseDown(link, { clientX: 10, clientY: 10, button: 0 });
        fireEvent.click(link, { clientX: 10, clientY: 10, button: 0 });
      });
      // The new tab's stand's off (the web's URL's branch): the open routes
      // over the same-tab's navigation (the jsdom's no-stand — the real
      // browser's stand is pinned over the e2e).
      expect(window.open).not.toHaveBeenCalled();
      cleanup(); // the fresh render's parity (the "world"'s anchor's single)
    }
  });

  it("the press-drag over the link stands no open (the selection's gesture's stand)", () => {
    const { doc } = seedDoc();
    const { link } = renderDoc(doc);

    act(() => {
      fireEvent.mouseDown(link, { clientX: 10, clientY: 10, button: 0 });
      // The 4 px's tolerance's over (the drag's stand).
      fireEvent.click(link, { clientX: 40, clientY: 10, button: 0 });
    });

    expect(window.open).not.toHaveBeenCalled();
  });

  it("the modified click (the cmd-click's stand) stands no handle (the browser's native's stand)", () => {
    const { doc } = seedDoc();
    const { link } = renderDoc(doc);

    act(() => {
      fireEvent.mouseDown(link, { clientX: 10, clientY: 10, button: 0, ctrlKey: true });
      fireEvent.click(link, { clientX: 10, clientY: 10, button: 0, ctrlKey: true });
    });

    expect(window.open).not.toHaveBeenCalled();
  });

  it("the unsafe scheme's text stands the plain stand (no anchor, no open)", () => {
    const doc = createDoc({ id: "link-click-unsafe", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "go raw now");
    // The raw Yjs's write (the remote input's stand — the validator is not
    // in the apply path): the renderer's gate stands the plain text.
    const yblocks = doc.raw.getMap("blocks");
    const yblock = yblocks.get(p) as { get: (key: string) => unknown };
    const ytext = yblock.get("content") as { format: (start: number, length: number, attrs: unknown) => void };
    ytext.format(0, 7, { link: { href: "javascript:alert(1)" } });

    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    const content = document.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(content).not.toBeNull();
    expect(content!.querySelector("a")).toBeNull();
    fireEvent.mouseDown(content!, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.click(content!, { clientX: 10, clientY: 10, button: 0 });
    expect(window.open).not.toHaveBeenCalled();
  });

  it("the click over the non-link's text stands no open", () => {
    const { doc } = seedDoc();
    const { link } = renderDoc(doc);

    act(() => {
      // The "go to" (the link's off).
      const content = link.closest<HTMLElement>("[data-slot='docblocks/block-content']");
      expect(content).not.toBeNull();
      fireEvent.mouseDown(content!, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.click(content!, { clientX: 10, clientY: 10, button: 0 });
    });

    expect(window.open).not.toHaveBeenCalled();
  });
});
