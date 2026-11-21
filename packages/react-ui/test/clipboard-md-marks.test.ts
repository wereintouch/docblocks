/**
 * The multi-block markdown paste (the text/plain branch): the code target
 * (the raw text), the inline html tags (the unified pass), and the
 * plain-text's linkify (the URL's + the email's forms).
 */
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { applyMdPaste } from "../src/editing/clipboard";
import { CREATED_AT, contentOf, docWithParagraph, rootBlocks } from "./clipboard-md.helpers";

describe("applyMdPaste: the code target (the raw text)", () => {
  it("the code target takes the fence as data (no parsing, no new blocks)", () => {
    const { doc } = docWithParagraph("");
    const codeId = doc.insertBlock("code", { language: "md" });
    const landing = applyMdPaste(doc, codeId, 0, 0, "# not a heading\n- not a list\n```\n");
    expect(rootBlocks(doc).length).toBe(2); // the seat paragraph + the code
    expect(contentOf(doc, codeId)).toBe("# not a heading\n- not a list\n```\n");
    expect(landing).toEqual({ blockId: codeId, offset: 33 });
  });
});

describe("applyMdPaste: the inline html tags (the unified pass)", () => {
  it("the marks land over the doc (the heading span, the br break, the structural line literal)", () => {
    const { doc, seat } = docWithParagraph("");
    applyMdPaste(doc, seat, 0, 0, "# T <b>жирный</b>\n- пункт <br> дальше\n<p>литерал</p>");
    const [headingId, itemId, paraId] = doc.getChildren(doc.meta.id);
    const heading = doc.getBlock(headingId!) as unknown as {
      content: Array<{ text: string; marks: Record<string, unknown> }>;
    };
    expect(heading.content).toEqual([
      { text: "T ", marks: {} },
      { text: "жирный", marks: { bold: true } },
    ]);
    const item = doc.getBlock(itemId!) as unknown as { content: Array<{ text: string }> };
    expect(item.content.map((r) => r.text).join("")).toBe("пункт \n дальше");
    const para = doc.getBlock(paraId!) as unknown as { content: Array<{ text: string }> };
    expect(para.content.map((r) => r.text).join("")).toBe("<p>литерал</p>");
  });

  it("the code target takes the tags raw (no parsing)", () => {
    const { doc } = docWithParagraph("");
    const codeId = doc.insertBlock("code", { language: "html" });
    applyMdPaste(doc, codeId, 0, 0, "<b>не жирный</b>\n<p>не абзац</p>");
    expect(contentOf(doc, codeId)).toBe("<b>не жирный</b>\n<p>не абзац</p>");
  });

  it("the autolink's other scheme (the mailto) degrades to the literal (the paste is not aborted over the core's rejection)", () => {
    // The repro: the parser's mailto mark stood the core's
    // InvalidMarkError (the data model's link contract is the http/https
    // / the relative) — the uncaught rejection aborted the whole paste.
    // The degrade stand: the literal text lands, the rest of the paste
    // stands intact (the doc write completes — the no-op stand stands the
    // empty seat over the rejection).
    const { doc, seat } = docWithParagraph("");
    const landing = applyMdPaste(doc, seat, 0, 0, "see <mailto:a@b.c> and <https://x.com>");
    expect(landing).not.toBeNull();
    expect(landing!.offset).toBeGreaterThan(0);
    const seatBlock = doc.getBlock(seat) as unknown as {
      content: Array<{ text: string; marks: Record<string, unknown> }>;
    };
    const text = seatBlock.content.map((run) => run.text).join("");
    expect(text).toBe("see <mailto:a@b.c> and https://x.com");
    const linkRuns = seatBlock.content.filter((run) => run.marks.link !== undefined);
    expect(linkRuns.map((run) => run.marks.link)).toEqual([{ href: "https://x.com" }]);
  });
});

describe("applyMdPaste: the plain-text's linkify (the URL's + the email's forms)", () => {
  it("a bare URL + a bare email pasted as plain text stand the link's marks (the phones' stand the plain)", () => {
    const { doc, seat } = docWithParagraph("");
    applyMdPaste(
      doc,
      seat,
      0,
      0,
      "see https://example.com/page now and call +7 (916) 123-45-67\nwrite to user@example.com"
    );
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(1);
    const runs = doc.getRuns(seat);
    // The soft break's stand: the lines' space-join over one paragraph.
    expect(runs.map((r) => r.text).join("")).toBe(
      "see https://example.com/page now and call +7 (916) 123-45-67 write to user@example.com"
    );
    expect(runs.filter((r) => r.marks.link !== undefined)).toEqual([
      { text: "https://example.com/page", marks: { link: { href: "https://example.com/page" } } },
      { text: "user@example.com", marks: { link: { href: "mailto:user@example.com" } } },
    ]);
  });

  it("the code target stands the raw text (the linkify's stand is off over the code's data)", () => {
    const doc = createDoc({ id: "doc-clip-md-link", createdAt: CREATED_AT });
    const code = doc.insertBlock("code");
    doc.insertText(code, 0, "");
    const landing = applyMdPaste(doc, code, 0, 0, "https://example.com user@example.com");
    expect(landing).not.toBeNull();
    expect(doc.getRuns(code)).toEqual([{ text: "https://example.com user@example.com", marks: {} }]);
  });

  it("the markdown's explicit link stands the parser's run (the no-relinkify's stand)", () => {
    const { doc, seat } = docWithParagraph("");
    applyMdPaste(doc, seat, 0, 0, "[text](https://example.com/a) and https://example.com/b");
    expect(doc.getRuns(seat)).toEqual([
      { text: "text", marks: { link: { href: "https://example.com/a" } } },
      { text: " and ", marks: {} },
      { text: "https://example.com/b", marks: { link: { href: "https://example.com/b" } } },
    ]);
  });
});
