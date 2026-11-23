// The document header tests' shared stand: the doc's seed, the controlled
// segment's fixture, the popover's async open's poll, and the per-test
// cleanup.
import { act, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { useState } from "react";

import { createDoc } from "docblocks-core";

import { SegmentSelector } from "../src/shared/ui";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "doc-header-doc", createdAt: CREATED_AT });
}

/** A controlled segment over the "a" | "b" values (the component's own state). */
function ControlledSegment() {
  const [value, setValue] = useState<"a" | "b">("a");
  return (
    <SegmentSelector
      options={[
        { value: "a", label: "Option A", icon: <span>icon-a</span> },
        { value: "b", label: "Option B", icon: <span>icon-b</span> },
      ]}
      value={value}
      onChange={setValue}
      ariaLabel="Test segment"
      slot="docblocks/test-segment"
      pillSlot="docblocks/test-segment-pill"
      buttonAttrName="test-segment-button"
    />
  );
}

afterEach(cleanup);

/** Waits for a predicate's non-null value over a deadline (the popover's async open). */
async function poll<T>(pred: () => T | null): Promise<T | null> {
  const deadline = Date.now() + 1000;
  for (;;) {
    let value: T | null = null;
    await act(async () => {
      value = pred();
    });
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export { ControlledSegment, newDoc, poll };
