// @vitest-environment jsdom
// The page-frame's dangling's stands (the lenient's placeholder, no
// throw): the gone's frame's id, the missing's frameId (a canvas's frame
// at the root), and the surface-less's frame (the invalid's context's
// lenient's posture).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT } from "./frame-page.helpers";

describe("the dangling's stands (the lenient placeholder — no throw)", () => {
  it("stands the placeholder over the gone frame's id", () => {
    const doc = createDoc({ id: "frame-page-gone-doc", createdAt: CREATED_AT });
    doc.insertBlock("frame", { frameId: "gone-frame" });
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const placeholder = document.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-missing"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("Frame not found");
    expect(document.querySelector('[data-slot="docblocks/frame-page-window"]')).toBeNull();
  });

  it("stands the placeholder over the missing frameId (a canvas frame at the root)", () => {
    const doc = createDoc({ id: "frame-page-missing-doc", createdAt: CREATED_AT });
    doc.insertBlock("frame", undefined);
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const placeholder = document.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-missing"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("Frame not found");
  });

  it("stands the placeholder over the surface-less frame (the invalid context's lenient posture)", () => {
    const doc = createDoc({ id: "frame-page-surfaless-doc", createdAt: CREATED_AT });
    // A frame at the root is not a canvas frame (the surface's child is
    // the canvas context) — no surface holds it, so the reference's
    // surface derivation stands nothing.
    const stray = doc.insertBlock("frame", { title: "Stray" });
    doc.insertBlock("frame", { frameId: stray });
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const placeholder = document.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-missing"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("Frame not found");
  });
});
