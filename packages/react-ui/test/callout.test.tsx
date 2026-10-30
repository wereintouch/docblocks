// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CALLOUT_ICONS, createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { CALLOUT_ICON_COMPONENTS, CALLOUT_PRESET_ICONS, calloutIconName } from "../src/blocks/callout-icon";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** Seed a single callout at the root and render provider + editor. */
function renderCallout(prepare: (doc: TestDoc) => void) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

const calloutEl = () => document.querySelector<HTMLElement>("[data-block-type='callout']");
const iconEl = () => document.querySelector<HTMLElement>("[data-slot='docblocks/callout-icon']");

afterEach(cleanup);

describe("callout icon resolver (the lenient reader)", () => {
  it("stands the preset per variant when the icon is absent or null", () => {
    expect(calloutIconName(undefined, "info")).toBe("info");
    expect(calloutIconName(undefined, "warning")).toBe("triangle-alert");
    expect(calloutIconName(undefined, "danger")).toBe("circle-x");
    expect(calloutIconName(null, "warning")).toBe("triangle-alert");
    // The absent variant defaults to the info preset.
    expect(calloutIconName(undefined, undefined)).toBe("info");
  });

  it("keeps a valid override and falls back to the preset for an unknown name", () => {
    expect(calloutIconName("star", "info")).toBe("star");
    expect(calloutIconName("lightbulb", "danger")).toBe("lightbulb");
    // An unknown name is not in the catalog: the preset stands (lenient).
    expect(calloutIconName("no-such-icon", "warning")).toBe("triangle-alert");
  });

  it("maps every preset icon to a catalog component (no drift)", () => {
    for (const [variant, icon] of Object.entries(CALLOUT_PRESET_ICONS)) {
      expect(CALLOUT_ICON_COMPONENTS[icon]).toBeDefined();
      expect(CALLOUT_ICONS).toContain(icon);
      // The preset name resolves back to itself (it is a catalog member).
      expect(calloutIconName(icon, variant as "info" | "warning" | "danger")).toBe(icon);
    }
  });

  it("has no drift between the render catalog and the core data catalog", () => {
    const renderKeys = Object.keys(CALLOUT_ICON_COMPONENTS).sort();
    const dataKeys = [...CALLOUT_ICONS].sort();
    expect(renderKeys).toEqual(dataKeys);
  });
});

describe("callout render (the preset + the override)", () => {
  it("renders the preset icon and color per variant (no override)", () => {
    renderCallout((doc) => doc.insertBlock("callout", { variant: "warning" }));
    const el = calloutEl();
    expect(el?.getAttribute("data-variant")).toBe("warning");
    // No color override stands: the attribute is absent and the preset
    // background token class is in the wrapper.
    expect(el?.hasAttribute("data-callout-color")).toBe(false);
    expect(el?.getAttribute("data-callout-icon")).toBe("triangle-alert");
    expect(el?.className).toContain("--docblocks-callout-background-warning");
  });

  it("defaults to the info preset when the variant is absent", () => {
    renderCallout((doc) => doc.insertBlock("callout"));
    const el = calloutEl();
    expect(el?.hasAttribute("data-variant")).toBe(false);
    expect(el?.getAttribute("data-callout-icon")).toBe("info");
    expect(el?.className).toContain("--docblocks-callout-background-info");
  });

  it("stands the color override (the inline border + the tinted background)", () => {
    renderCallout((doc) => doc.insertBlock("callout", { variant: "info", color: "#ff0000" }));
    const el = calloutEl();
    expect(el?.getAttribute("data-callout-color")).toBe("#ff0000");
    // jsdom normalizes the inline hex to rgb.
    expect(el?.style.borderLeftColor).toBe("rgb(255, 0, 0)");
    expect(el?.style.background).toContain("color-mix");
    // The preset background token class stands no override (the inline wins).
    expect(iconEl()).not.toBeNull();
  });

  it("stands the icon override and keeps the variant", () => {
    renderCallout((doc) => doc.insertBlock("callout", { variant: "danger", icon: "star" }));
    const el = calloutEl();
    expect(el?.getAttribute("data-variant")).toBe("danger");
    expect(el?.getAttribute("data-callout-icon")).toBe("star");
  });

  it("treats an explicit null override as the preset (the cleared stand)", () => {
    renderCallout((doc) => doc.insertBlock("callout", { variant: "info", color: null, icon: null }));
    const el = calloutEl();
    expect(el?.hasAttribute("data-callout-color")).toBe(false);
    expect(el?.getAttribute("data-callout-icon")).toBe("info");
    expect(el?.style.borderLeftColor).toBe("");
  });
});
