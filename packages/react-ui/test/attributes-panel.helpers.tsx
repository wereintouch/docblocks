// The document-attributes panel tests' shared stand: the render fixture
// (the provider's props over the `Editor`'s view) + the panel / the row's
// DOM reads + the expand's gesture + the per-test cleanup.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import { createDoc } from "docblocks-core";
import type { AttributeType, Doc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import type { DocDescription, DocTags, RenderAttributeProps } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

interface RenderOptions {
  doc?: Doc;
  mode?: "edit" | "view" | "published";
  view?: "page" | "canvas";
  hiddenAttributes?: readonly string[];
  prepare?: (doc: Doc) => void;
  renderAttribute?: (props: RenderAttributeProps) => React.ReactNode;
  attributeTypePicker?: React.ComponentType<{
    value: AttributeType;
    onChange: (type: AttributeType) => void;
  }>;
  docTags?: DocTags;
  docDescription?: DocDescription;
}

function renderEditor(options: RenderOptions = {}): Doc {
  const doc = options.doc ?? createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
  if (options.prepare !== undefined) options.prepare(doc);
  render(
    <EditorProvider
      doc={doc}
      mode={options.mode}
      hiddenAttributes={options.hiddenAttributes}
      renderAttribute={options.renderAttribute}
      attributeTypePicker={options.attributeTypePicker}
      docTags={options.docTags}
      docDescription={options.docDescription}
    >
      <Editor view={options.view ?? "page"} />
    </EditorProvider>
  );
  return doc;
}

/** The panel's root. */
const panel = () => document.querySelector<HTMLElement>('[data-slot="docblocks/attributes"]');
const body = () => document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-body"]');

/** Expands the panel (the toggle's click). */
function expand(): HTMLElement {
  const toggle = document.querySelector<HTMLElement>('[data-slot="docblocks/attributes-toggle"]');
  expect(toggle, "the toggle should be rendered").not.toBeNull();
  act(() => {
    fireEvent.click(toggle!);
  });
  const expanded = body();
  expect(expanded, "the body should stand over the toggle's click").not.toBeNull();
  return expanded!;
}

/** The row of the given key. */
const row = (key: string) =>
  document.querySelector<HTMLElement>(`[data-slot="docblocks/attribute-row"][data-attribute-key="${key}"]`);

afterEach(() => {
  cleanup();
});

export { CREATED_AT, body, expand, panel, renderEditor, row };
export type { RenderOptions };
