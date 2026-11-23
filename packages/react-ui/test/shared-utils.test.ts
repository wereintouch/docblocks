import { describe, expect, it } from "vitest";

import { isSafeDownloadHref } from "../src/shared/utils";

describe("the download href's gate", () => {
  it("stands the safe schemes (the default store's data urls, the consumer's CDN)", () => {
    expect(isSafeDownloadHref("https://cdn.test/files/42.pdf")).toBe(true);
    expect(isSafeDownloadHref("http://localhost:5199/blob/42")).toBe(true);
    expect(isSafeDownloadHref("blob:https://app.test/9f1c")).toBe(true);
    expect(isSafeDownloadHref("data:application/pdf;base64,JVBERi0=")).toBe(true);
    expect(isSafeDownloadHref("/relative/path/file.pdf")).toBe(true);
  });

  it("rejects the executable schemes over the raw form", () => {
    expect(isSafeDownloadHref("javascript:alert(1)")).toBe(false);
    expect(isSafeDownloadHref("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeDownloadHref("JAVASCRIPT:alert(1)")).toBe(false);
    expect(isSafeDownloadHref(" javascript:alert(1)")).toBe(false);
    expect(isSafeDownloadHref("\u0000\u0000javascript:alert(1)")).toBe(false);
  });

  // The browser's WHATWG normalization (the link href's parity): the URL
  // parser removes U+0009/U+000A/U+000D from ANY position — the mid-string
  // forms resolve to the `javascript:` scheme on the click.
  it("rejects the mid-string control bypasses (the browser resolves them to the executable scheme)", () => {
    expect(isSafeDownloadHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeDownloadHref("java\tscript:alert(1)")).toBe(false);
    expect(isSafeDownloadHref("java\rscript:alert(1)")).toBe(false);
  });

  it("stands the non-string stand (no anchor over the absent url)", () => {
    expect(isSafeDownloadHref(undefined)).toBe(false);
    expect(isSafeDownloadHref(null)).toBe(false);
    expect(isSafeDownloadHref(42)).toBe(false);
  });
});
