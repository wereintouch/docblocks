import { describe, expect, it } from "vitest";

import { PACKAGE } from "../src/index";

describe("docblocks-core scaffold", () => {
  it("exposes the package marker", () => {
    expect(PACKAGE).toBe("docblocks-core");
  });
});
