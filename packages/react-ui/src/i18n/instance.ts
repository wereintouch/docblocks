import { createInstance } from "i18next";
import type { i18n as I18nInstance } from "i18next";
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

/** The shipped en+ru resources (the catalogs are the only source of the UI's strings). */
const RESOURCES = {
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
};

/** The i18next init's options over the package's catalogs (the inline resources resolve synchronously — the instance is ready by the first render). */
const INIT_OPTIONS = {
  resources: RESOURCES,
  fallbackLng: "en",
  supportedLngs: ["en", "ru"],
  interpolation: { escapeValue: false, prefix: "{", suffix: "}" },
  returnNull: false,
};

/** The supported-set's resolution over a raw language string (the prefix's normalization — `ru-RU` is `ru`, `en-US` is `en`): the absent / unknown language falls back to `en`. */
function toDocblocksLang(lang: string): DocblocksLang {
  return lang.trim().toLowerCase().startsWith("ru") ? "ru" : "en";
}

/**
 * Normalizes a consumer-passed locale over the supported set (the same
 * rules as the `<html lang>`'s read): the `ru*` prefix is `ru`, the `en*`
 * and the unknown / empty's values fall back to `en`.
 */
export function normalizeDocblocksLocale(locale: string): DocblocksLang {
  return toDocblocksLang(locale);
}

/**
 * The document's language over the supported set (the `<html lang>`
 * attribute's read — the legacy uncontrolled mode's source): the absent /
 * unknown language falls back to `en`.
 */
export function resolveDocblocksLang(): DocblocksLang {
  return toDocblocksLang(typeof document === "undefined" ? "" : (document.documentElement.lang ?? ""));
}

/**
 * Creates a package's i18next instance over the given language: the
 * controlled mode's instance (one per provider over its normalized locale —
 * no shared cache over a mutable language, no mutation of the legacy
 * singleton), isolated from the consumer's i18next setup. `init` over the
 * inline resources runs synchronously (its Promise is not awaited — the
 * instance is ready by the first render), so the returned value is the
 * instance itself, not the init's Promise.
 */
export function createDocblocksI18nInstance(lng: DocblocksLang): I18nInstance {
  const instance = createInstance().use(initReactI18next);
  void instance.init({ ...INIT_OPTIONS, lng });
  return instance;
}

/**
 * The package's OWN i18next instance (not the global singleton): the legacy
 * uncontrolled mode's seat — it is initialized over the package's shipped
 * en+ru catalogs, starts on the `<html lang>`'s read (the `en`'s fallback
 * over the server's render, no document), and never touches the consumer's
 * i18next setup (the `I18nextProvider` over the docblocks' subtree routes
 * `useTranslation` here).
 */
const docblocksI18n = createDocblocksI18nInstance(resolveDocblocksLang());
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
