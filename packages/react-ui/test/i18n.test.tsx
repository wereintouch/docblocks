// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { DocHeader } from "../src/DocHeader";
import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { DocblocksI18nProvider, docblocksI18n, resolveDocblocksLang } from "../src/i18n";
// The shipped catalogs (the parity's stand: the en/ru key sets must match,
// and every value stands a non-empty string — the consumer renders the
// language over the <html lang> attribute, the catalogs are the only
// source of the UI's strings).
import blocksEn from "../src/i18n/locales/en/blocks.json";
import canvasEn from "../src/i18n/locales/en/canvas.json";
import commonEn from "../src/i18n/locales/en/common.json";
import databaseEn from "../src/i18n/locales/en/database.json";
import editorEn from "../src/i18n/locales/en/editor.json";
import frameEn from "../src/i18n/locales/en/frame.json";
import slashEn from "../src/i18n/locales/en/slash.json";
import tableEn from "../src/i18n/locales/en/table.json";
import blocksRu from "../src/i18n/locales/ru/blocks.json";
import canvasRu from "../src/i18n/locales/ru/canvas.json";
import commonRu from "../src/i18n/locales/ru/common.json";
import databaseRu from "../src/i18n/locales/ru/database.json";
import editorRu from "../src/i18n/locales/ru/editor.json";
import frameRu from "../src/i18n/locales/ru/frame.json";
import slashRu from "../src/i18n/locales/ru/slash.json";
import tableRu from "../src/i18n/locales/ru/table.json";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The key paths of a nested catalog object. */
function keyPathsOf(node: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return value !== null && typeof value === "object" ? keyPathsOf(value as Record<string, unknown>, path) : [path];
  });
}

const CATALOGS: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
  ["blocks", blocksEn, blocksRu],
  ["canvas", canvasEn, canvasRu],
  ["common", commonEn, commonRu],
  ["database", databaseEn, databaseRu],
  ["editor", editorEn, editorRu],
  ["frame", frameEn, frameRu],
  ["slash", slashEn, slashRu],
  ["table", tableEn, tableRu],
];

afterEach(() => {
  cleanup();
  document.documentElement.lang = "";
});

describe("the shipped catalogs", () => {
  it("stands the en/ru key parity over every namespace (no drift)", () => {
    for (const [ns, en, ru] of CATALOGS) {
      const enKeys = new Set(keyPathsOf(en));
      const ruKeys = new Set(keyPathsOf(ru));
      expect(ruKeys, `the ru's ${ns} keys drift from the en's`).toEqual(enKeys);
      // Every value stands a non-empty string (the empty's stand is the
      // missing key's stand, never the shipped catalog's).
      for (const key of enKeys) {
        const enValue = enKeyOf(en, key);
        const ruValue = enKeyOf(ru, key);
        expect(typeof enValue, `${ns} > ${key} (en)`).toBe("string");
        expect((enValue as string).trim(), `${ns} > ${key} (en) is empty`).not.toBe("");
        expect(typeof ruValue, `${ns} > ${key} (ru)`).toBe("string");
        expect((ruValue as string).trim(), `${ns} > ${key} (ru) is empty`).not.toBe("");
      }
    }
  });
});

/** Reads a nested catalog value by its dot path. */
function enKeyOf(node: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], node);
}

describe("the package's i18n instance", () => {
  it("stands the language over the <html lang> attribute (the prefix's stand + the en's fallback)", () => {
    document.documentElement.lang = "ru";
    expect(resolveDocblocksLang()).toBe("ru");
    document.documentElement.lang = "ru-RU";
    expect(resolveDocblocksLang()).toBe("ru");
    document.documentElement.lang = "en-US";
    expect(resolveDocblocksLang()).toBe("en");
    document.documentElement.lang = "fr";
    expect(resolveDocblocksLang()).toBe("en");
    document.documentElement.lang = "";
    expect(resolveDocblocksLang()).toBe("en");
  });

  it("follows the attribute's change at runtime (the consumer's flip)", async () => {
    document.documentElement.lang = "ru";
    await waitFor(() => expect(docblocksI18n.t("common:copy")).toBe("Копировать"), {
      timeout: 3000,
    });
    document.documentElement.lang = "en";
    await waitFor(() => expect(docblocksI18n.t("common:copy")).toBe("Copy"), { timeout: 3000 });
    expect(docblocksI18n.language).toBe("en");
  });

  it("stands the ru's interpolation (the {error}'s stand over the pdf's degrade)", async () => {
    document.documentElement.lang = "ru";
    await waitFor(
      () =>
        expect(docblocksI18n.t("blocks:code.pdfPreviewUnavailable", { error: "boom" })).toBe(
          "Превью PDF недоступно (boom). Показан встроенный просмотрщик."
        ),
      { timeout: 3000 }
    );
  });
});

describe("the editor's chrome over the language", () => {
  it("localizes the empty block's command hint and follows the language flip", async () => {
    document.documentElement.lang = "ru";
    const doc = createDoc({ id: "doc-i18n-placeholder", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    const inner = document.querySelector('[data-slot="docblocks/block-content"]');
    await waitFor(() => expect(inner?.getAttribute("data-placeholder")).toBe("Введите «/» для команд"));
    document.documentElement.lang = "en";
    await waitFor(() => expect(inner?.getAttribute("data-placeholder")).toBe("Type '/' for commands"));
  });

  it("stands the ru's aria-labels at lang=ru and follows back to the en's", async () => {
    const doc = createDoc({ id: "doc-i18n", createdAt: CREATED_AT });
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "text");
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    document.documentElement.lang = "ru";
    await waitFor(
      () =>
        expect(document.querySelector('[data-slot="docblocks/gutter-plus"]')?.getAttribute("aria-label")).toBe(
          "Добавить блок ниже"
        ),
      { timeout: 3000 }
    );

    document.documentElement.lang = "en";
    await waitFor(
      () =>
        expect(document.querySelector('[data-slot="docblocks/gutter-plus"]')?.getAttribute("aria-label")).toBe(
          "Add block below"
        ),
      { timeout: 3000 }
    );
  });
});

describe("the controlled locale's provider (the hydration's parity + the inheritance)", () => {
  it("the SSR's markup and the hydration's render agree over the same locale (no hydration mismatch)", async () => {
    const doc = createDoc({ id: "doc-i18n-hydration", createdAt: CREATED_AT });
    const element = (
      <DocblocksI18nProvider locale="ru">
        <DocHeader view="page" onViewChange={() => {}} doc={doc} />
      </DocblocksI18nProvider>
    );
    const markup = renderToString(<div id="rb">{element}</div>);
    document.body.innerHTML = markup;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => {
        hydrateRoot(document.getElementById("rb")!, element);
      });
    } finally {
      errorSpy.mockRestore();
    }
    expect(document.querySelector('[aria-label="Вид документа"]')).not.toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("the nested uncontrolled provider inherits the outer's locale over the opposite <html lang>", async () => {
    document.documentElement.lang = "ru";
    const doc = createDoc({ id: "doc-i18n-inherit", createdAt: CREATED_AT });
    render(
      <DocblocksI18nProvider locale="en">
        <DocblocksI18nProvider>
          <DocHeader view="page" onViewChange={() => {}} doc={doc} />
        </DocblocksI18nProvider>
      </DocblocksI18nProvider>
    );
    await waitFor(() =>
      expect(document.querySelector('[aria-label="Document view"]'), "the en's inheritance").not.toBeNull()
    );
  });

  it("the locale's prop change at runtime re-renders the subtree over the new instance", async () => {
    const doc = createDoc({ id: "doc-i18n-runtime", createdAt: CREATED_AT });
    const view = render(
      <DocblocksI18nProvider locale="ru">
        <DocHeader view="page" onViewChange={() => {}} doc={doc} />
      </DocblocksI18nProvider>
    );
    await waitFor(
      () => expect(document.querySelector('[aria-label="Вид документа"]'), "the ru's initial").not.toBeNull(),
      { timeout: 3000 }
    );
    view.rerender(
      <DocblocksI18nProvider locale="en">
        <DocHeader view="page" onViewChange={() => {}} doc={doc} />
      </DocblocksI18nProvider>
    );
    await waitFor(
      () => expect(document.querySelector('[aria-label="Document view"]'), "the en's re-render").not.toBeNull(),
      { timeout: 3000 }
    );
  });
});
