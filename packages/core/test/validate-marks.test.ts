import { describe, expect, it } from "vitest";

import { validateDoc } from "../src/schema";
import type { DocJSON, MarkSet, TextRun } from "../src/schema";

const run = (text: string, marks: MarkSet = {}): TextRun => ({ text, marks });

function makeDoc(overrides: Partial<DocJSON> = {}): DocJSON {
  return {
    v: 1,
    id: "r",
    title: "T",
    createdAt: "2026-10-08T10:00:00Z",
    blocks: { r: { type: "root", children: [] } },
    ...overrides,
  };
}

const expectValid = (doc: unknown) => expect(validateDoc(doc)).toEqual([]);

const expectError = (doc: unknown, path: string, needle: string) => {
  const errors = validateDoc(doc);
  const hit = errors.find((e) => e.path === path && e.message.includes(needle));
  expect(hit, `expected an error at "${path}" mentioning "${needle}"; got ${JSON.stringify(errors)}`).toBeDefined();
};

describe("runs and marks", () => {
  const withContent = (content: unknown) => ({
    ...makeDoc(),
    blocks: { r: { type: "root", children: ["p"] }, p: { type: "paragraph", content } },
  });

  it("validates run shape", () => {
    expectValid(withContent([run("x")]));
    expectError(withContent([{ marks: {} }]), "blocks.p.content[0].text", "must be a string");
    expectError(withContent([{ text: 5, marks: {} }]), "blocks.p.content[0].text", "must be a string");
    expectError(withContent([{ text: "x" }]), "blocks.p.content[0].marks", "run.marks is required");
    expectError(withContent([{ text: "x", marks: "x" }]), "blocks.p.content[0].marks", "plain object");
    expectError(withContent(["x"]), "blocks.p.content[0]", "plain object");
  });

  it("validates mark names, values, and exclusive rules", () => {
    expectError(
      withContent([{ text: "x", marks: { strikethrough: true } }]),
      "blocks.p.content[0].marks.strikethrough",
      "Unknown mark"
    );
    expectError(withContent([{ text: "x", marks: { bold: false } }]), "blocks.p.content[0].marks.bold", "must be true");
    expectError(withContent([{ text: "x", marks: { bold: {} } }]), "blocks.p.content[0].marks.bold", "must be true");
    // The mailto / tel / relative forms stand the contract; a foreign scheme does not.
    expectValid(withContent([run("x", { link: { href: "mailto:a@b.c" } })]));
    expectValid(withContent([run("x", { link: { href: "tel:+79161234567" } })]));
    expectValid(withContent([run("x", { link: { href: "/docs/page" } })]));
    expectError(withContent([run("x", { link: { href: "mailto:nope" } })]), "blocks.p.content[0].marks.link", "href");
    expectError(
      withContent([run("x", { link: { href: "javascript:alert(1)" } })]),
      "blocks.p.content[0].marks.link",
      "href"
    );
    expectError(withContent([{ text: "x", marks: { link: {} } }]), "blocks.p.content[0].marks.link", "href");
    expectError(
      withContent([{ text: "x", marks: { link: { href: "https://e.com", title: "t" } } }]),
      "blocks.p.content[0].marks.link.title",
      "Unknown attribute"
    );
    expectError(withContent([run("x", { color: { value: "#123" } })]), "blocks.p.content[0].marks.color", "hex color");
    expectError(
      withContent([run("x", { highlight: { value: "abc" } })]),
      "blocks.p.content[0].marks.highlight",
      "hex color"
    );
    expectError(
      withContent([{ text: "x", marks: { math: { tex: "x" } } }]),
      "blocks.p.content[0].marks.math",
      "Unknown mark"
    );
    expectError(
      withContent([{ text: "x", marks: { color: {} } }]),
      "blocks.p.content[0].marks.color",
      "requires a value"
    );
    expectError(withContent([{ text: "x", marks: { link: { href: "" } } }]), "blocks.p.content[0].marks.link", "href");
    expectError(
      withContent([{ text: "x", marks: { bold: "true" } }]),
      "blocks.p.content[0].marks.bold",
      "must be true"
    );
    expectError(withContent([{ text: "x", marks: { bold: null } }]), "blocks.p.content[0].marks.bold", "must be true");
    expectError(withContent([run("x", { code: true, bold: true })]), "blocks.p.content[0].marks", "exclusive");
  });

  it("the mention mark: kind enum + non-empty id/label, combinable", () => {
    expectValid(withContent([run("@Jane", { mention: { kind: "user", id: "u1", label: "Jane" } })]));
    expectValid(withContent([run("@Spec", { mention: { kind: "doc", id: "d9", label: "Spec" } })]));
    // Combinable (non-exclusive): the mention composes with other marks.
    expectValid(withContent([run("@Jane", { mention: { kind: "user", id: "u1", label: "Jane" }, bold: true })]));
    // A bad kind enum.
    expectError(
      withContent([
        { text: "x", marks: { mention: { kind: "page", id: "u1", label: "Jane" } as unknown as MarkSet["mention"] } },
      ]),
      "blocks.p.content[0].marks.mention.kind",
      "one of"
    );
    // Missing id.
    expectError(
      withContent([
        { text: "x", marks: { mention: { kind: "user", label: "Jane" } as unknown as MarkSet["mention"] } },
      ]),
      "blocks.p.content[0].marks.mention.id",
      "requires"
    );
    // An empty id.
    expectError(
      withContent([{ text: "x", marks: { mention: { kind: "user", id: "", label: "Jane" } } }]),
      "blocks.p.content[0].marks.mention.id",
      "non-empty"
    );
    // The id-only stand: a missing label is valid (the label is the run's
    // text + the consumer's resolution — the mark stands the identity only).
    expectValid(
      withContent([{ text: "x", marks: { mention: { kind: "user", id: "u1" } as unknown as MarkSet["mention"] } }])
    );
    // An empty label (when present) is rejected.
    expectError(
      withContent([{ text: "x", marks: { mention: { kind: "user", id: "u1", label: "" } } }]),
      "blocks.p.content[0].marks.mention.label",
      "non-empty"
    );
    // A non-string field.
    expectError(
      withContent([
        { text: "x", marks: { mention: { kind: "user", id: 5, label: "Jane" } as unknown as MarkSet["mention"] } },
      ]),
      "blocks.p.content[0].marks.mention.id",
      "must be a string"
    );
    // An unknown field.
    expectError(
      withContent([
        {
          text: "x",
          marks: { mention: { kind: "user", id: "u1", label: "Jane", href: "x" } as unknown as MarkSet["mention"] },
        },
      ]),
      "blocks.p.content[0].marks.mention.href",
      "Unknown attribute"
    );
  });

  it("forbids marks inside code blocks", () => {
    expectError(
      {
        ...makeDoc(),
        blocks: { r: { type: "root", children: ["co"] }, co: { type: "code", content: [run("x", { bold: true })] } },
      },
      "blocks.co.content[0].marks",
      "code block must not carry marks"
    );
  });
});
