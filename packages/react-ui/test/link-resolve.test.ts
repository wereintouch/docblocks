// @vitest-environment jsdom
/**
 * The link popover's input's resolution (the smart scheme's inference):
 * the explicit scheme's pass-through (the core's gate's stand), the
 * protocol-relative's explicit https's stand, the relative's forms, the
 * email's / the phone's inference, and the bare's form's `https://`'s
 * prefix.
 */
import { describe, expect, it } from "vitest";

import { resolveLinkHref } from "../src/editing/link";

describe("resolveLinkHref: the explicit scheme's stand", () => {
  it.each([
    "https://example.com/page?q=1",
    "http://example.com",
    "mailto:help@example.com",
    "tel:+79161234567",
    "MAILTO:help@example.com",
  ])("$value stands as-is", (value) => {
    expect(resolveLinkHref(value)).toBe(value);
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "myapp://doc/1", "ftp://example.com"])(
    "$value stands the rejection",
    (value) => {
      expect(resolveLinkHref(value)).toBeNull();
    }
  );
});

describe("resolveLinkHref: the relative's forms", () => {
  it.each(["/docs/page", "#section", "./relative/path"])("$value stands the relative's form", (value) => {
    expect(resolveLinkHref(value)).toBe(value);
  });
});

describe("resolveLinkHref: the protocol-relative form", () => {
  it("a typed protocol-relative host stands the explicit https's form", () => {
    expect(resolveLinkHref("//example.com/page")).toBe("https://example.com/page");
    expect(resolveLinkHref("/\\example.com")).toBe("https://example.com");
    expect(resolveLinkHref("\\\\example.com")).toBe("https://example.com");
    expect(resolveLinkHref("  //example.com  ")).toBe("https://example.com");
  });
});

describe("resolveLinkHref: the email's / the phone's inference", () => {
  it("a bare email stands the mailto's form", () => {
    expect(resolveLinkHref("help@example.com")).toBe("mailto:help@example.com");
    expect(resolveLinkHref(" user@sub.example.co.uk ")).toBe("mailto:user@sub.example.co.uk");
  });

  it("the no-TLD's email stands the rejection (the core's gate's parity)", () => {
    expect(resolveLinkHref("user@localhost")).toBeNull();
  });

  it.each(["+79161234567", "+7 (916) 123-45-67", "8001234567", "8 800 123-45-67"])(
    "$value stands the tel's form",
    (value) => {
      expect(resolveLinkHref(value)).toBe(`tel:${value}`);
    }
  );

  it("the 4-digits' token stands the no-phone's stand (the bare's form over it)", () => {
    expect(resolveLinkHref("1234")).toBe("https://1234");
  });
});

describe("resolveLinkHref: the bare's form (the https's prefix)", () => {
  it.each(["example.com", "example.com/page?q=1", "1.2.3"])("$value stands the https's form", (value) => {
    expect(resolveLinkHref(value)).toBe(`https://${value}`);
  });
});

describe("resolveLinkHref: the rejection's stand", () => {
  it.each(["", "   "])("$value stands null", (value) => {
    expect(resolveLinkHref(value)).toBeNull();
  });

  it("the multi-word's bare's input stands the rejection (the single-token's URL's form)", () => {
    expect(resolveLinkHref("not a link at all!!!")).toBeNull();
  });
});
