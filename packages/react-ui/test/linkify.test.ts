// @vitest-environment jsdom
/**
 * The plain-text paste's linkify (the `linkifyRuns`'s pure pass): the
 * bare web's URLs + the email's forms stand the link's mark, the phones /
 * the versions / the dates' tokens stand the plain, the code's / the
 * linked's / the mention's runs pass through, and the run's own marks
 * compose with the link.
 */
import { describe, expect, it } from "vitest";

import type { TextRun } from "docblocks-core";

import { linkifyRuns } from "../src/editing/linkify";

const run = (text: string, marks: TextRun["marks"] = {}): TextRun => ({ text, marks });

describe("linkifyRuns: the URL's forms", () => {
  it("a bare URL in the middle of the text stands the link (the plain's parts around)", () => {
    expect(linkifyRuns([run("see https://example.com/page now")])).toEqual([
      { text: "see ", marks: {} },
      { text: "https://example.com/page", marks: { link: { href: "https://example.com/page" } } },
      { text: " now", marks: {} },
    ]);
  });

  it("the trailing sentence's punctuation stands outside the link (the trim's stand)", () => {
    expect(linkifyRuns([run("visit https://example.com.")])).toEqual([
      { text: "visit ", marks: {} },
      { text: "https://example.com", marks: { link: { href: "https://example.com" } } },
      { text: ".", marks: {} },
    ]);
  });

  it("the balanced paren's stand: the deep-link's `A_(B)` keeps its paren, the unbalanced's drops the sentence's one", () => {
    expect(
      linkifyRuns([run("wiki https://en.wikipedia.org/wiki/A_(B) and https://example.com/a(b))")]).map((r) => r.text)
    ).toEqual(["wiki ", "https://en.wikipedia.org/wiki/A_(B)", " and ", "https://example.com/a(b)", ")"]);
    expect(linkifyRuns([run("wiki https://en.wikipedia.org/wiki/A_(B)")])[1]!.marks.link).toEqual({
      href: "https://en.wikipedia.org/wiki/A_(B)",
    });
  });

  it("the token's middle stands the plain (the no-alnum look-behind's stand)", () => {
    expect(linkifyRuns([run("xhttps://example.com")])).toEqual([{ text: "xhttps://example.com", marks: {} }]);
  });

  it("the empty body's stand (`https://` + the punct only) degrades to the plain", () => {
    expect(linkifyRuns([run("https://.")])).toEqual([{ text: "https://.", marks: {} }]);
  });

  it("the two URLs in one run stand the two links", () => {
    expect(
      linkifyRuns([run("https://a.example and https://b.example/page?q=1")]).filter((r) => r.marks.link !== undefined)
    ).toHaveLength(2);
  });
});

describe("linkifyRuns: the email's forms", () => {
  it("a bare email stands the mailto's link", () => {
    expect(linkifyRuns([run("write to user@example.com now")])).toEqual([
      { text: "write to ", marks: {} },
      { text: "user@example.com", marks: { link: { href: "mailto:user@example.com" } } },
      { text: " now", marks: {} },
    ]);
  });

  it("the trailing punct stands outside; the subdomain's domain stands the full form", () => {
    expect(linkifyRuns([run("at user@sub.example.co.uk.")])).toEqual([
      { text: "at ", marks: {} },
      { text: "user@sub.example.co.uk", marks: { link: { href: "mailto:user@sub.example.co.uk" } } },
      { text: ".", marks: {} },
    ]);
  });

  it("the `mailto:`'s prefix's residue stands the plain (the no-relink's stand)", () => {
    expect(linkifyRuns([run("mailto:user@example.com")])).toEqual([{ text: "mailto:user@example.com", marks: {} }]);
  });
});

describe("linkifyRuns: the no-link's forms (the plain's stand)", () => {
  it.each([
    "call +7 (916) 123-45-67 now", // the phone's form (the manual's stand only)
    "v1.2.3 and 2026-11-21", // the versions / the dates' tokens
    "12345",
    "user@example.com5", // the token's continuation (the look-ahead's stand)
  ])("$text stands the plain", (text) => {
    expect(linkifyRuns([run(text)])).toEqual([run(text)]);
  });
});

describe("linkifyRuns: the marks' composition + the pass-through", () => {
  it("the run's own marks compose with the link (the bold's URL stands the bold's link)", () => {
    expect(linkifyRuns([run("see https://a.example", { bold: true })])).toEqual([
      { text: "see ", marks: { bold: true } },
      { text: "https://a.example", marks: { bold: true, link: { href: "https://a.example" } } },
    ]);
  });

  it("the code's mark / the linked's / the mention's runs pass through untouched", () => {
    const code = run("https://a.example", { code: true });
    const linked = run("plain", { link: { href: "https://b.example" } });
    const mention = run("@x", { mention: { kind: "user", id: "u1" } });
    expect(linkifyRuns([code, linked, mention])).toEqual([code, linked, mention]);
  });
});
