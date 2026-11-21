// @vitest-environment jsdom
// The link href's open's stand (the kind's classifier's routing): the web's
// URL stands the new tab, the `mailto` / `tel` / the relative's forms stand
// the same tab (the browser's scheme's handler), and an href outside the
// safe contract navigates nowhere. The `window.open`'s primitive is spied;
// the same-tab's `location.assign` is non-configurable in jsdom, so its
// branch stands the pure target's gate.
import { describe, expect, it, vi } from "vitest";

import { linkHrefKindOf } from "docblocks-core";

import { linkOpenTargetOf, openLinkHref } from "../src/editing/link-open";

describe("linkOpenTargetOf (the open's tab stand over the href's class)", () => {
  const CASES: { href: string; kind: string; target: "new-tab" | "same-tab" }[] = [
    { href: "https://example.com/page?q=1", kind: "web", target: "new-tab" },
    { href: "http://example.com", kind: "web", target: "new-tab" },
    { href: "\thttps://example.com", kind: "web", target: "new-tab" },
    { href: "mailto:help@example.com", kind: "mailto", target: "same-tab" },
    { href: "tel:+79161234567", kind: "tel", target: "same-tab" },
    { href: "/docs/page", kind: "relative", target: "same-tab" },
    { href: "#section", kind: "relative", target: "same-tab" },
  ];

  it.each(CASES)("$href stands $target (the $kind's stand)", ({ href, kind, target }) => {
    // The classifier's parity (the core's contract stands the input).
    expect(linkHrefKindOf(href)).toBe(kind);
    expect(linkOpenTargetOf(href)).toBe(target);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://example.com", ""])(
    "%s stands no target (the open's rejection)",
    (href) => {
      expect(linkOpenTargetOf(href)).toBeNull();
    }
  );
});

describe("openLinkHref (the navigation's primitive)", () => {
  it("opens the web's URL over the new tab with noopener,noreferrer", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openLinkHref("https://example.com/page");
    expect(open).toHaveBeenCalledWith("https://example.com/page", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("navigates nowhere over an unsafe href (its own gate)", () => {
    // The same-tab's `location.assign` is non-configurable in jsdom (no
    // spy); the primitive's gate is the target's null, and the web branch's
    // primitive stands the spy.
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    for (const href of ["javascript:alert(1)", "data:text/html,x", "java\tscript:alert(1)"]) {
      expect(linkOpenTargetOf(href)).toBeNull();
      openLinkHref(href);
    }
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
