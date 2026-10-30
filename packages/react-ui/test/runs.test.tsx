// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { TextRun } from "docblocks-core";

import { renderRuns } from "../src/text";

afterEach(cleanup);

function renderText(runs: TextRun[]): HTMLElement {
  const { container } = render(<div>{renderRuns(runs)}</div>);
  return container;
}

/** A run with plain text and the given marks. */
const run = (text: string, marks: TextRun["marks"] = {}): TextRun => ({ text, marks });

describe("renderRuns", () => {
  it("renders a plain run without wrapping", () => {
    const el = renderText([run("hello")]);
    expect(el.textContent).toBe("hello");
    expect(el.querySelector("span, strong, em, s, u, a, code")).toBeNull();
  });

  it("renders toggle marks as the matching tags", () => {
    const el = renderText([
      run("b", { bold: true }),
      run("i", { italic: true }),
      run("s", { strike: true }),
      run("u", { underline: true }),
    ]);
    expect(el.querySelector("strong")?.textContent).toBe("b");
    expect(el.querySelector("em")?.textContent).toBe("i");
    expect(el.querySelector("s")?.textContent).toBe("s");
    expect(el.querySelector("u")?.textContent).toBe("u");
  });

  it("nests combined marks on one run", () => {
    const el = renderText([run("x", { bold: true, italic: true, underline: true, link: { href: "https://x" } })]);
    const link = el.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://x");
    // Nesting is outermost-first: underline > italic > bold > link.
    expect(el.querySelector("u em strong a")?.textContent).toBe("x");
  });

  it("renders a link without other marks", () => {
    const el = renderText([run("site", { link: { href: "https://a.b" } })]);
    const link = el.querySelector("a");
    expect(link?.textContent).toBe("site");
    expect(link?.querySelector("strong, em, s, u")).toBeNull();
  });

  it("renders color and highlight as inline styles", () => {
    const el = renderText([run("c", { color: { value: "#ff0000" }, highlight: { value: "#00ff00" } })]);
    const span = el.querySelector("span");
    expect(span?.style.color).toBe("rgb(255, 0, 0)");
    expect(span?.style.backgroundColor).toBe("rgb(0, 255, 0)");
  });

  it("skips a highlight without a value", () => {
    const el = renderText([run("h", { highlight: {} })]);
    expect(el.querySelector("span")).toBeNull();
    expect(el.textContent).toBe("h");
  });

  it("renders the exclusive code mark alone, dropping the rest", () => {
    const el = renderText([run("code", { code: true, bold: true })]);
    const code = el.querySelector("code");
    expect(code?.textContent).toBe("code");
    expect(code?.querySelector("strong")).toBeNull();
  });

  it("keeps the text of a run with only unknown marks (lenient reader)", () => {
    const el = renderText([run("ok", { unknown: true } as TextRun["marks"])]) as HTMLElement;
    expect(el.textContent).toBe("ok");
    expect(el.querySelector("strong, em, s, u, a, span, code")).toBeNull();
  });

  it("renders an empty run list as nothing", () => {
    const el = renderText([]);
    expect(el.textContent).toBe("");
  });
});
