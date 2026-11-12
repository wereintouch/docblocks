// The controlled locale's SSR contract (the node's environment — no global
// document): the server's render and the first client's render must receive
// the same locale, independent of the <html lang> attribute. The uncontrolled
// mode (the <html lang>-driven instance) keeps its behavior — its pins live
// over the jsdom's suite (the i18n's spec).
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { DocHeader } from "../src/DocHeader";
import { DocblocksI18nProvider } from "../src/i18n";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** Renders the header over the controlled locale (the consumer passes its
 * own resolved locale — the server's one, the client's). */
function renderHeaderSsr(locale?: string) {
  const doc = createDoc({ id: "doc-i18n-ssr", createdAt: CREATED_AT });
  return renderToString(
    <DocblocksI18nProvider locale={locale}>
      <DocHeader view="page" onViewChange={() => {}} doc={doc} />
    </DocblocksI18nProvider>
  );
}

describe("the controlled locale's SSR (the node's render, no document)", () => {
  it("the locale's prop renders the ru's aria-labels over the server's render", () => {
    const html = renderHeaderSsr("ru");
    expect(html).toContain("Вид документа");
    expect(html).toContain("Вид страницы");
    expect(html).not.toContain("Document view");
  });

  it("the en's locale renders the en's aria-labels", () => {
    const html = renderHeaderSsr("en");
    expect(html).toContain("Document view");
    expect(html).toContain("Page view");
  });

  it("normalizes the passed locale over the existing rules (the ru* / the en's fallback)", () => {
    expect(renderHeaderSsr("ru-RU")).toContain("Вид документа");
    expect(renderHeaderSsr("en-US")).toContain("Document view");
    // The unknown / the empty's locale falls back to the en's.
    expect(renderHeaderSsr("fr")).toContain("Document view");
    expect(renderHeaderSsr("")).toContain("Document view");
  });

  it("isolates the sequential renders (no language inherited from the previous request)", () => {
    expect(renderHeaderSsr("ru")).toContain("Вид документа");
    const en = renderHeaderSsr("en");
    expect(en).toContain("Document view");
    expect(en).not.toContain("Вид документа");
    expect(renderHeaderSsr("ru")).toContain("Вид документа");
  });

  it("the nested uncontrolled provider inherits the outer's controlled instance", () => {
    const doc = createDoc({ id: "doc-i18n-nested", createdAt: CREATED_AT });
    const html = renderToString(
      <DocblocksI18nProvider locale="ru">
        <DocblocksI18nProvider>
          <DocHeader view="page" onViewChange={() => {}} doc={doc} />
        </DocblocksI18nProvider>
      </DocblocksI18nProvider>
    );
    expect(html).toContain("Вид документа");
  });

  it("the uncontrolled provider over the server's render keeps the en's fallback (the legacy's behavior)", () => {
    const doc = createDoc({ id: "doc-i18n-legacy-ssr", createdAt: CREATED_AT });
    const html = renderToString(
      <DocblocksI18nProvider>
        <DocHeader view="page" onViewChange={() => {}} doc={doc} />
      </DocblocksI18nProvider>
    );
    expect(html).toContain("Document view");
  });
});
