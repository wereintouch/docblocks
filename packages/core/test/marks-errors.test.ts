import { describe, expect, it } from "vitest";

import {
  DocBlocksError,
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  createDoc,
  fromJSON,
} from "../src/core";
import type { Doc } from "../src/core";
import { isSafeLinkHref, linkHrefKindOf, validateDoc } from "../src/schema";
import type { MarkName } from "../src/schema";

/**
 * The mark command errors (the sibling of marks.test.ts): the typed
 * rejections over the write path, the link's scheme gate, and the
 * lenient load's poisoned-href stand.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "d", createdAt: CREATED_AT });

const expectThrows = (fn: () => unknown, ctor: new (message: string) => Error): Error => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    expect(error).toBeInstanceOf(DocBlocksError);
    return error as Error;
  }
  throw new Error("expected the command to throw");
};

/** The fixture's document: one plain run "Help us sync faster!" (20 chars). */
const markedDoc = (): { doc: Doc; id: string } => {
  const doc = newDoc();
  const id = doc.insertBlock("paragraph");
  doc.insertText(id, 0, "Help us sync faster!");
  return { doc, id };
};

describe("mark command errors", () => {
  it("code block and non-text target -> InvalidOperationError", () => {
    const doc = newDoc();
    const code = doc.insertBlock("code");
    doc.insertText(code, 0, "abc");
    expect(() => doc.setMark(code, 0, 1, { type: "bold" })).toThrow(InvalidOperationError);
    const divider = doc.insertBlock("divider");
    expect(() => doc.setMark(divider, 0, 1, { type: "bold" })).toThrow(InvalidOperationError);
  });

  it("missing block -> UnknownBlockError", () => {
    expect(() => newDoc().setMark("nope", 0, 1, { type: "bold" })).toThrow(UnknownBlockError);
    expect(() => newDoc().unsetMark("nope", 0, 1, "bold")).toThrow(UnknownBlockError);
  });

  it("structurally invalid mark input -> InvalidMarkError", () => {
    const { doc, id } = markedDoc();
    expect(() => doc.setMark(id, 0, 1, { type: "color", value: "red" })).toThrow(InvalidMarkError);
    expect(() => doc.setMark(id, 0, 1, { type: "link", href: "javascript:alert(1)" })).toThrow(InvalidMarkError);
    expect(() => doc.unsetMark(id, 0, 1, "bogus" as MarkName)).toThrow(InvalidMarkError);
  });

  it("the unsafe-scheme rejection stands the browser's C0 / space trim (no leading-control bypass)", () => {
    // The browser trims the leading C0 controls + spaces (U+0000–U+0020)
    // before the scheme detection: the raw string stands no scheme, the
    // browser's does — the check runs over the trimmed form.
    const { doc, id } = markedDoc();
    for (const href of [
      "\tjavascript:alert(1)",
      "\njavascript:alert(1)",
      "\u0000javascript:alert(1)",
      "  javascript:alert(1)",
      "\x1fjavascript:alert(1)",
    ]) {
      expect(
        () => doc.setMark(id, 0, 1, { type: "link", href }),
        `the href ${JSON.stringify(href)} should be rejected`
      ).toThrow(InvalidMarkError);
    }
    // The trim stands the safe stand: a C0-prefixed http URL is the http URL.
    doc.setMark(id, 0, 1, { type: "link", href: "\thttps://example.com" });
    expect(doc.getRuns(id)[0]!.marks.link).toEqual({ href: "\thttps://example.com" });
  });

  it("the mailto / tel forms pass the write path (the link's scheme contract)", () => {
    const { doc, id } = markedDoc();
    doc.setMark(id, 0, 4, { type: "link", href: "mailto:help@example.com" });
    expect(doc.getRuns(id)[0]!.marks.link).toEqual({ href: "mailto:help@example.com" });
    doc.unsetMark(id, 0, 4, "link");
    doc.setMark(id, 0, 4, { type: "link", href: "tel:+79161234567" });
    expect(doc.getRuns(id)[0]!.marks.link).toEqual({ href: "tel:+79161234567" });
    // The bad payloads stand the rejection (the validator's stand over the
    // write path).
    expect(() => doc.setMark(id, 0, 4, { type: "link", href: "mailto:nope" })).toThrow(InvalidMarkError);
    expect(() => doc.setMark(id, 0, 4, { type: "link", href: "tel:1234" })).toThrow(InvalidMarkError);
  });

  it("the isSafeLinkHref contract (the public renderer's gate)", () => {
    expect(isSafeLinkHref("https://example.com")).toBe(true);
    expect(isSafeLinkHref("http://example.com")).toBe(true);
    expect(isSafeLinkHref("#fragment")).toBe(true);
    expect(isSafeLinkHref("/relative/path")).toBe(true);
    expect(isSafeLinkHref("\thttps://example.com")).toBe(true);
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("\tjavascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("\u0000javascript:alert(1)")).toBe(false);
    // The WHATWG URL parser removes ASCII tab / LF / CR from ANY position
    // before the scheme detection — the gate mirrors it, so a mid-string
    // control cannot hide the scheme ("java\tscript:…" resolves as
    // "javascript:…" in the browser).
    expect(isSafeLinkHref("java\tscript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("java\rscript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("data:text/html,<script>alert(1)</script>")).toBe(false);
    // The mailto's stand (the email's local@domain form; the no-TLD / the
    // no-local's stands are rejected, the whitespace inside is rejected).
    expect(isSafeLinkHref("mailto:a@b.c")).toBe(true);
    expect(isSafeLinkHref("MAILTO:A@B.C")).toBe(true);
    expect(isSafeLinkHref("mailto:nope")).toBe(false);
    expect(isSafeLinkHref("mailto:@b.c")).toBe(false);
    expect(isSafeLinkHref("mailto:a b@c.d")).toBe(false);
    expect(isSafeLinkHref("mailto:a@b")).toBe(false);
    // The tel's stand (the digits + the phone's separators, the 5-digits'
    // minimum; the scheme is case-insensitive over the web's parity).
    expect(isSafeLinkHref("tel:+79161234567")).toBe(true);
    expect(isSafeLinkHref("tel:+7 (916) 123-45-67")).toBe(true);
    expect(isSafeLinkHref("TEL:8001234567")).toBe(true);
    expect(isSafeLinkHref("tel:12345")).toBe(true);
    expect(isSafeLinkHref("tel:1234")).toBe(false);
    expect(isSafeLinkHref("tel:+- - ")).toBe(false);
    // The payload's length's edges (the 30-character bound's inclusive stand).
    expect(isSafeLinkHref(`tel:${"1".repeat(30)}`)).toBe(true);
    expect(isSafeLinkHref("tel:1234567890123456789012345678901")).toBe(false);
    // The other schemes stay rejected (the custom deep-links' stand).
    expect(isSafeLinkHref("ftp://example.com")).toBe(false);
    expect(isSafeLinkHref("myapp://doc/1")).toBe(false);
    expect(isSafeLinkHref("")).toBe(false);
    expect(isSafeLinkHref("   ")).toBe(false);
  });

  it("the linkHrefKindOf classifier (the href's class over the gate)", () => {
    expect(linkHrefKindOf("https://example.com")).toBe("web");
    expect(linkHrefKindOf("  http://example.com  ")).toBe("web");
    // The protocol-relative form is the web's absolute URL (the browser
    // resolves it against the reader's scheme), never a relative path — the
    // backslash pair stands the WHATWG's special-scheme equivalence.
    expect(linkHrefKindOf("//example.com/page")).toBe("web");
    expect(linkHrefKindOf("/\\example.com/page")).toBe("web");
    expect(linkHrefKindOf("\\/example.com")).toBe("web");
    expect(linkHrefKindOf("\\\\example.com")).toBe("web");
    expect(linkHrefKindOf("mailto:help@example.com")).toBe("mailto");
    expect(linkHrefKindOf("tel:+79161234567")).toBe("tel");
    expect(linkHrefKindOf("/relative/path")).toBe("relative");
    expect(linkHrefKindOf("#fragment")).toBe("relative");
    // The rejection's stand: the unsafe schemes, the empty's form.
    expect(linkHrefKindOf("javascript:alert(1)")).toBeNull();
    expect(linkHrefKindOf("data:text/html,x")).toBeNull();
    expect(linkHrefKindOf("")).toBeNull();
    // The boolean projection cannot disagree (the single classifier).
    for (const href of ["https://example.com", "mailto:a@b.c", "tel:12345", "/p", "ftp://e.com", ""]) {
      expect(isSafeLinkHref(href)).toBe(linkHrefKindOf(href) !== null);
    }
  });

  it("the lenient load stands the poisoned href (the persistence DoS stand; the renderer's gate stands the display)", () => {
    const { doc, id } = markedDoc();
    // The write path rejects the unsafe scheme; the snapshot's load does
    // not (the reader's contract stands the data, the renderer's gate
    // stands the href — a throwing fromJSON would DoS the room over the
    // poisoned snapshot).
    expect(() => doc.setMark(id, 0, 1, { type: "link", href: "javascript:alert(1)" })).toThrow(InvalidMarkError);
    const json = JSON.parse(JSON.stringify(doc.toJSON())) as {
      blocks: Record<string, { content?: Array<{ marks?: Record<string, { href?: string }> }> }>;
    };
    const block = json.blocks[id]!;
    expect(block).toBeDefined();
    const runs = block.content;
    runs![0]!.marks = { link: { href: "javascript:alert(1)" } };
    const loaded = fromJSON(json as Parameters<typeof fromJSON>[0]);
    const loadedRuns = loaded.getRuns(id);
    expect(loadedRuns[0]!.marks.link).toEqual({ href: "javascript:alert(1)" });
    // The strict posture stands the rejection (the writer's stand over
    // the data we own).
    const errors = validateDoc(json);
    expect(errors.some((error) => error.message.includes('"link"'))).toBe(true);
  });

  it("invalid ranges -> InvalidRangeError; from === to is a no-op", () => {
    const { doc, id } = markedDoc();
    expect(() => doc.setMark(id, 12, 8, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.setMark(id, 0, 21, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.setMark(id, -1, 5, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.unsetMark(id, 12, 8, "bold")).toThrow(InvalidRangeError);
    expect(() => doc.setMark(id, 8, 8, { type: "bold" })).not.toThrow();
    expect(() => doc.unsetMark(id, 8, 8, "bold")).not.toThrow();
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: {} }]);
  });

  it("rejects a non-integer range without mutating the block", () => {
    const { doc, id } = markedDoc();
    const before = doc.encode().byteLength;
    expect(() => doc.setMark(id, 8, 12.5, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.setMark(id, 8.5, 12, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.unsetMark(id, 8, 12.5, "bold")).toThrow(InvalidRangeError);
    expect(() => doc.unsetMark(id, 8.5, 12, "bold")).toThrow(InvalidRangeError);
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: {} }]);
    expect(doc.encode().byteLength).toBe(before);
  });

  it("throws for an out-of-bounds from === to instead of no-op-ing", () => {
    const { doc, id } = markedDoc();
    expect(() => doc.setMark(id, 99, 99, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.unsetMark(id, 99, 99, "bold")).toThrow(InvalidRangeError);
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: {} }]);
  });

  it("errors carry the offending block id and are DocBlocksError", () => {
    const { doc, id } = markedDoc();
    const error = expectThrows(() => doc.setMark(id, 0, 1, { type: "color", value: "red" }), InvalidMarkError);
    expect(error).toBeInstanceOf(DocBlocksError);
    expect(error.message).toContain(id);
  });
});
