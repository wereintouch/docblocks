// @vitest-environment jsdom
// The provider's access level and mode: the effective-mode's resolution
// (the defaults, the view / the published's read-only, the viewer's
// forced published, the nested provider's inheritance).
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { EditorProvider, useEditorContext } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

describe("the access level and the mode (the effective-mode's resolution)", () => {
  beforeEach(() => {
    captureRef.current = null;
  });
  afterEach(cleanup);

  /** The provider's context stand (the mode's effective's read). */
  const captureRef = { current: null as null | { accessLevel: string; mode: string; viewMode: boolean } };
  function ContextProbe() {
    const ctx = useEditorContext();
    captureRef.current = { accessLevel: ctx.accessLevel, mode: ctx.mode, viewMode: ctx.viewMode };
    return null;
  }

  it("stands the defaults (the editor's editable live doc)", () => {
    const doc = createDoc({ id: "doc-access-1", createdAt: CREATED_AT });
    render(
      <EditorProvider doc={doc}>
        <ContextProbe />
      </EditorProvider>
    );
    expect(captureRef.current).toEqual({ accessLevel: "editor", mode: "edit", viewMode: false });
  });

  it("stands the view's read-only over the mode's stand", () => {
    const doc = createDoc({ id: "doc-access-2", createdAt: CREATED_AT });
    render(
      <EditorProvider doc={doc} mode="view">
        <ContextProbe />
      </EditorProvider>
    );
    expect(captureRef.current).toEqual({ accessLevel: "editor", mode: "view", viewMode: true });
  });

  it("stands the published's read-only over the mode's stand", () => {
    const doc = createDoc({ id: "doc-access-3", createdAt: CREATED_AT });
    const snapshot = createDoc({ id: "doc-access-3", createdAt: CREATED_AT });
    render(
      <EditorProvider doc={doc} mode="published" publishedDoc={snapshot}>
        <ContextProbe />
      </EditorProvider>
    );
    expect(captureRef.current).toEqual({ accessLevel: "editor", mode: "published", viewMode: true });
  });

  it("the viewer stands the published over any mode (the current state's stand off)", () => {
    const doc = createDoc({ id: "doc-access-4", createdAt: CREATED_AT });
    const snapshot = createDoc({ id: "doc-access-4", createdAt: CREATED_AT });
    render(
      <EditorProvider doc={doc} accessLevel="viewer" mode="edit" publishedDoc={snapshot}>
        <ContextProbe />
      </EditorProvider>
    );
    expect(captureRef.current).toEqual({ accessLevel: "viewer", mode: "published", viewMode: true });
  });

  it("a nested provider without its own mode inherits the enclosing's (the sync-embed's parity)", () => {
    const doc = createDoc({ id: "doc-access-5", createdAt: CREATED_AT });
    const b = doc.insertBlock("paragraph");
    render(
      <EditorProvider doc={doc} mode="view">
        <EditorProvider doc={doc} rootBlockId={b}>
          <ContextProbe />
        </EditorProvider>
      </EditorProvider>
    );
    expect(captureRef.current).toEqual({ accessLevel: "editor", mode: "view", viewMode: true });
  });
});
