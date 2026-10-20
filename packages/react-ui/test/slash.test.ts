// The slash menu's pure logic: the live derivation of the query from the
// block text (the doc is the source of truth) and the apply decision (what
// a picked command does to the trigger block).
import { describe, expect, it } from "vitest";

import type { Block } from "docblocks-core";

import { SLASH_COMMANDS, deriveSlash, filterCommands, planSlashApply } from "../src/editing/slash";

const command = (label: string) => {
  const found = SLASH_COMMANDS.find((c) => c.label === label);
  if (found === undefined) throw new Error(`unknown command label "${label}"`);
  return found;
};

/** A minimal block snapshot (the plan reads only the type, attrs, and content). */
function textBlock(type: string, text: string, attrs?: Record<string, unknown>): Block {
  const block: Record<string, unknown> = { id: "b1", type };
  if (text !== "") block.content = [{ text, marks: [] }];
  if (attrs !== undefined) block.attrs = attrs;
  return block as unknown as Block;
}

describe("deriveSlash", () => {
  it("stands open right after the trigger: the anchor at 0, the caret after it", () => {
    const d = deriveSlash("/", 0, 1);
    expect(d).toEqual({ closed: false, query: "", queryEnd: 1 });
  });

  it("grows the query with the typed characters (the caret at the query's end)", () => {
    const d = deriveSlash("/hea", 0, 4);
    expect(d).toEqual({ closed: false, query: "hea", queryEnd: 4 });
  });

  it("ends the query at a space: the caret past the boundary closes the window", () => {
    expect(deriveSlash("/hea ", 0, 5).closed).toBe(true);
    // The caret still inside the window (just before the space) stands.
    expect(deriveSlash("/hea ", 0, 4)).toEqual({ closed: false, query: "hea", queryEnd: 4 });
  });

  it("ends the query at a soft line break the same way", () => {
    expect(deriveSlash("/hea\n", 0, 5).closed).toBe(true);
    expect(deriveSlash("/hea\n", 0, 4).query).toBe("hea");
  });

  it("closes when the anchor's character is no longer the / (the trigger deleted or edited away)", () => {
    // Backspacing the "/" leaves an empty text (the anchor misses).
    expect(deriveSlash("", 0, 0).closed).toBe(true);
    // An edit at the anchor's offset replaces the "/".
    expect(deriveSlash("x", 0, 1).closed).toBe(true);
    // An edit before the "/" shifts it: the offset anchor gives up on a miss.
    expect(deriveSlash("a/b", 0, 2).closed).toBe(true);
  });

  it("closes when the caret moves to the slash or before it", () => {
    expect(deriveSlash("/hea", 0, 0).closed).toBe(true);
    expect(deriveSlash("a/hea", 1, 1).closed).toBe(true);
  });

  it("deleting the query back to the / re-opens the full list (the query is empty again)", () => {
    // "/zz" (zero matches, hidden list) backspaced to "/": the anchor stands,
    // the caret right after it, the query empty.
    const d = deriveSlash("/", 0, 1);
    expect(d.closed).toBe(false);
    expect(d.query).toBe("");
  });

  it("tracks a trigger mid-text: the query is the suffix after the anchor", () => {
    const d = deriveSlash("my task/task", 7, 11);
    expect(d).toEqual({ closed: false, query: "task", queryEnd: 12 });
  });
});

describe("filterCommands", () => {
  it("stands the full list on an empty query", () => {
    expect(filterCommands("")).toHaveLength(16);
  });

  it("filters by a case-insensitive substring of the label", () => {
    expect(filterCommands("head").map((c) => c.label)).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    expect(filterCommands("HEAD").map((c) => c.label)).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    expect(filterCommands("list").map((c) => c.label)).toEqual(["Bulleted list", "Numbered list", "Task list"]);
    expect(filterCommands("quote").map((c) => c.label)).toEqual(["Quote"]);
    expect(filterCommands("image").map((c) => c.label)).toEqual(["Image"]);
    expect(filterCommands("database").map((c) => c.label)).toEqual(["Database"]);
    expect(filterCommands("table").map((c) => c.label)).toEqual(["Table"]);
  });

  it("stands at zero on a miss (the menu hides, not a placeholder)", () => {
    expect(filterCommands("zz")).toHaveLength(0);
  });
});

describe("planSlashApply", () => {
  it("is a no-op when the command equals the block's current shape", () => {
    const block = textBlock("heading", "note/head", { level: 2 });
    expect(planSlashApply(command("Heading 2"), block, "note/head", 4, false)).toEqual({ kind: "noop" });
  });

  it("replaces a phrase-only block with the command's type (the v1 empty-block path)", () => {
    const block = textBlock("paragraph", "/head");
    expect(planSlashApply(command("Heading 2"), block, "/head", 0, false)).toEqual({ kind: "replace" });
  });

  it("is an insert for the table, never a convert: the caret block stands and the phrase is stripped", () => {
    // A phrase-only block (the replace path would take its slot) converts
    // in place: the table lands after it.
    const phraseOnly = textBlock("paragraph", "/tab");
    expect(planSlashApply(command("Table"), phraseOnly, "/tab", 0, false)).toEqual({
      kind: "update",
      deleteFrom: 0,
      deleteTo: 4,
    });
    // A non-empty block keeps its prefix and suffix; the trigger phrase
    // between them is stripped.
    const withText = textBlock("paragraph", "keep /tab tail");
    expect(planSlashApply(command("Table"), withText, "keep /tab tail", 5, false)).toEqual({
      kind: "update",
      deleteFrom: 5,
      deleteTo: 9,
    });
  });

  it("does not replace a phrase-only block that owns a derived segment (the removal would cascade it) — it converts in place", () => {
    const block = textBlock("paragraph", "/head");
    const plan = planSlashApply(command("Heading 2"), block, "/head", 0, true);
    expect(plan).toEqual({ kind: "convert", deleteFrom: 0, deleteTo: 5 });
  });

  it("converts a different-type command and strips only the trigger phrase", () => {
    const block = textBlock("paragraph", "my task/task");
    const plan = planSlashApply(command("Task list"), block, "my task/task", 7, false);
    // The phrase "/task" is [7, 12): the stripped text stands "my task".
    expect(plan).toEqual({ kind: "convert", deleteFrom: 7, deleteTo: 12 });
  });

  it("updates the attrs when the command keeps the block's type (a kind swap)", () => {
    const block = textBlock("list-item", "todo/task", { list: "bullet" });
    const plan = planSlashApply(command("Task list"), block, "todo/task", 4, false);
    expect(plan).toEqual({ kind: "update", deleteFrom: 4, deleteTo: 9 });
  });

  it("converts a phrase-only block into a quote (the replace path) and keeps the phrase's tail over text", () => {
    // Phrase-only: the empty result and a type change take the replace path.
    const phraseOnly = textBlock("paragraph", "/quote");
    expect(planSlashApply(command("Quote"), phraseOnly, "/quote", 0, false)).toEqual({ kind: "replace" });
    // Text survives: the phrase is stripped, the block converts in place.
    const withText = textBlock("paragraph", "my words/quote");
    const plan = planSlashApply(command("Quote"), withText, "my words/quote", 8, false);
    expect(plan).toEqual({ kind: "convert", deleteFrom: 8, deleteTo: 14 });
  });

  it("is a no-op when the block is already a quote", () => {
    const block = textBlock("quote", "note/quote");
    expect(planSlashApply(command("Quote"), block, "note/quote", 4, false)).toEqual({ kind: "noop" });
  });

  it("updates the attrs and strips the phrase when the block's attrs differ only by the patch's scope (a heading level change)", () => {
    const block = textBlock("heading", "h1/2", { level: 1 });
    const plan = planSlashApply(command("Heading 2"), block, "h1/2", 2, false);
    expect(plan).toEqual({ kind: "update", deleteFrom: 2, deleteTo: 4 });
  });

  it("is a no-op close for the divider over surviving text (the content cannot survive the type change)", () => {
    const block = textBlock("paragraph", "note/div");
    expect(planSlashApply(command("Divider"), block, "note/div", 4, false)).toEqual({ kind: "noop" });
  });

  it("stands the divider's replace for a phrase-only block (a contentless insert loses nothing)", () => {
    const block = textBlock("paragraph", "/div");
    expect(planSlashApply(command("Divider"), block, "/div", 0, false)).toEqual({ kind: "replace" });
  });

  it("is a no-op close for the divider over a phrase-only block that owns a derived segment (the removal would cascade it — the phrase stays)", () => {
    const block = textBlock("paragraph", "/div");
    expect(planSlashApply(command("Divider"), block, "/div", 0, true)).toEqual({ kind: "noop" });
  });

  it("updates a phrase-only same-type block with followers: the phrase is stripped, the followers stand", () => {
    const block = textBlock("list-item", "/task", { list: "bullet" });
    const plan = planSlashApply(command("Task list"), block, "/task", 0, true);
    expect(plan).toEqual({ kind: "update", deleteFrom: 0, deleteTo: 5 });
  });
});
