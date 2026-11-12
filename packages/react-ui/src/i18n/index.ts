// The i18n unit's cross-unit surface: the package's i18next instances (the
// legacy's <html lang>-driven singleton + the controlled mode's factory)
// and the provider's scope over the docblocks' subtree.
export { createDocblocksI18nInstance, docblocksI18n, normalizeDocblocksLocale, resolveDocblocksLang } from "./instance";
export type { DocblocksLang } from "./instance";
export { DocblocksI18nProvider } from "./provider";
export type { DocblocksI18nProviderProps } from "./provider";
