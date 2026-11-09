import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import blocksEn from "./locales/en/blocks.json";
import canvasEn from "./locales/en/canvas.json";
import commonEn from "./locales/en/common.json";
import databaseEn from "./locales/en/database.json";
import editorEn from "./locales/en/editor.json";
import frameEn from "./locales/en/frame.json";
import slashEn from "./locales/en/slash.json";
import tableEn from "./locales/en/table.json";
import blocksRu from "./locales/ru/blocks.json";
import canvasRu from "./locales/ru/canvas.json";
import commonRu from "./locales/ru/common.json";
import databaseRu from "./locales/ru/database.json";
import editorRu from "./locales/ru/editor.json";
import frameRu from "./locales/ru/frame.json";
import slashRu from "./locales/ru/slash.json";
import tableRu from "./locales/ru/table.json";

/** The supported language codes (the consumer's `<html lang>` is validated against this set). */
export type DocblocksLang = "en" | "ru";

/**
 * The document's language over the supported set (the prefix's stand —
 * `ru-RU` stands `ru`, `en-US` stands `en`): the absent / unknown language
 * falls back to `en`. The library language is consumer-driven — the only
 * source is the `<html lang>` attribute (no locale prop).
 */
export function resolveDocblocksLang(): DocblocksLang {
  const lang = (typeof document === "undefined" ? "" : (document.documentElement.lang ?? "")).trim().toLowerCase();
  return lang.startsWith("ru") ? "ru" : "en";
}

/**
 * The package's OWN i18next instance (not the global singleton): it is
 * initialized over the package's shipped en+ru catalogs and never touches
 * the consumer's i18next setup (the `I18nextProvider` over the docblocks'
 * subtree routes `useTranslation` here). The inline resources resolve
 * synchronously, so the instance is ready by the first render.
 */
const docblocksI18n = createInstance().use(initReactI18next);
docblocksI18n.init({
  resources: {
    en: {
      blocks: blocksEn,
      canvas: canvasEn,
      common: commonEn,
      database: databaseEn,
      editor: editorEn,
      frame: frameEn,
      slash: slashEn,
      table: tableEn,
    },
    ru: {
      blocks: blocksRu,
      canvas: canvasRu,
      common: commonRu,
      database: databaseRu,
      editor: editorRu,
      frame: frameRu,
      slash: slashRu,
      table: tableRu,
    },
  },
  lng: resolveDocblocksLang(),
  fallbackLng: "en",
  supportedLngs: ["en", "ru"],
  interpolation: { escapeValue: false, prefix: "{", suffix: "}" },
  returnNull: false,
});
// The `<html lang>`'s change subscription (the consumer flips the attribute
// at runtime — the instance follows, the subscribers re-render through
// react-i18next): one observer over the instance's lifetime.
if (typeof document !== "undefined") {
  const observer = new MutationObserver(() => {
    const lng = resolveDocblocksLang();
    if (docblocksI18n.language !== lng) void docblocksI18n.changeLanguage(lng);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
}

export { docblocksI18n };
