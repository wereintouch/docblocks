import { describe, expect, it } from "vitest";

import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

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

describe("the frame context rules (two contexts, one type)", () => {
  /** The frame's scene: a surface with a canvas frame + a page frame in the root. */
  const frameDoc = (canvasFrame: Record<string, unknown>, pageFrame?: Record<string, unknown>) => ({
    ...makeDoc(),
    blocks: {
      r: { type: "root", children: pageFrame === undefined ? ["s"] : ["s", "pf"] },
      ...(pageFrame === undefined ? {} : { pf: pageFrame }),
      s: { type: "surface", children: ["f"] },
      f: canvasFrame,
    },
  });

  it("accepts the canvas frame (a surface child with the optional title) and the page-frame block (a root child with the frameId)", () => {
    expectValid(frameDoc({ type: "frame", attrs: { title: "Camera" } }, { type: "frame", attrs: { frameId: "f" } }));
    expectValid(frameDoc({ type: "frame" })); // the title is optional in the canvas context
    expectValid(frameDoc({ type: "frame", attrs: { title: "" } })); // the empty string = the removed state
  });

  it("a frame in the root's children requires the frameId (missing / empty)", () => {
    expectError(
      frameDoc({ type: "frame" }, { type: "frame" }),
      "blocks.pf.attrs.frameId",
      'requires a non-empty "frameId"'
    );
    // The empty string: the registry's nonEmpty rule stands (the value rule).
    expectError(
      frameDoc({ type: "frame" }, { type: "frame", attrs: { frameId: "" } }),
      "blocks.pf.attrs.frameId",
      "non-empty string"
    );
  });

  it("a frame in the root's children must not carry a title", () => {
    expectError(
      frameDoc({ type: "frame" }, { type: "frame", attrs: { frameId: "f", title: "Camera" } }),
      "blocks.pf.attrs.title",
      'must not carry a "title"'
    );
  });

  it("a frame in a surface's children must not carry a frameId", () => {
    expectError(
      frameDoc({ type: "frame", attrs: { frameId: "other" } }),
      "blocks.f.attrs.frameId",
      'must not carry a "frameId"'
    );
  });

  it("a frame with children is a structural error (the strict posture)", () => {
    expectError(
      frameDoc({ type: "frame", children: ["x"] }),
      "blocks.f.children",
      'Block type "frame" has no children'
    );
  });
});
