// @vitest-environment jsdom
// The rich `text/html` paste's hostile input: the parse reads the marks'
// whitelist only, so an arbitrary attribute of the pasted markup (an event
// handler, a style outside the hex stand) never reaches the model — the
// rendered DOM is a fresh render of the runs, not the pasted element.
import { describe, expect, it } from "vitest";

import { htmlToBlocks } from "../src/editing/clipboard";

describe("the hostile paste markup", () => {
  it("stands the marks and the text only (no event handlers reach the runs)", () => {
    const blocks = htmlToBlocks(
      '<p onmouseover="alert(1)" onclick="alert(2)">' +
        '<a href="https://example.com" onmouseover="alert(3)" onerror="alert(4)">link</a> ' +
        '<span style="color: #ff0000; background-image: url(javascript:alert(5))" onfocus="alert(6)">red</span>' +
        '<img src="x" onerror="alert(7)">' +
        "</p>"
    );
    expect(blocks).toHaveLength(1);
    // The href and the hex color are the marks' whitelist; the rest of the
    // attributes stand no channel into the model.
    expect(blocks[0]!.runs.map((run) => [run.text, run.marks])).toEqual([
      ["link", { link: { href: "https://example.com" } }],
      [" ", {}],
      ["red", { color: { value: "#ff0000" } }],
    ]);
    for (const run of blocks[0]!.runs) {
      expect(Object.keys(run).sort()).toEqual(["marks", "text"]);
      expect(JSON.stringify(run.marks)).not.toMatch(/on[a-z]+=/);
    }
  });
});
