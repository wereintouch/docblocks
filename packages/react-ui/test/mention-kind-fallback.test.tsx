// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { TextRun } from "docblocks-core";

import { MENTION_SLOT, renderRunsInto } from "../src/text";

/** A mention run over the given kind (the out-of-enum value stands the wire's lenient data). */
const mentionRun = (kind: string): TextRun => ({
  text: "@someone",
  marks: { mention: { kind: kind as "user", id: "u-1" } },
});

describe("renderRunsInto — the mention's kind's fallback", () => {
  it("renders the chip over an out-of-enum kind (the lenient data stands, no throw)", () => {
    const container = document.createElement("div");
    expect(() => renderRunsInto([mentionRun("hostile-kind")], container)).not.toThrow();
    const chip = container.querySelector(`[data-slot="${MENTION_SLOT}"]`);
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-mention-kind")).toBe("hostile-kind");
    // The fallback stands the `doc`'s icon's geometry (the 3-path's set).
    expect(chip?.querySelectorAll("svg path").length).toBe(3);
    expect(chip?.textContent).toBe("@someone");
  });

  it("keeps the kind's own icon over the enum's kinds", () => {
    const container = document.createElement("div");
    renderRunsInto([mentionRun("user")], container);
    // The `user`'s icon carries the head's circle (the `doc`'s fallback does not).
    expect(container.querySelector(`[data-slot="${MENTION_SLOT}"] svg circle`)).not.toBeNull();
  });
});
