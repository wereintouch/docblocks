import { describe, expect, it } from "vitest";

import { PACKAGE as CORE_PACKAGE } from "docblocks-core";

describe("docblocks-react-ui scaffold", () => {
  it("resolves docblocks-core through the workspace (public entry only)", () => {
    expect(CORE_PACKAGE).toBe("docblocks-core");
  });
});
