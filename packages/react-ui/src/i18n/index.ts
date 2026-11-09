// The i18n unit's cross-unit surface: the package's own i18next instance
// (the `<html lang>`-driven, the ru/en catalogs) and the provider scope
// over the docblocks' subtree.
export { docblocksI18n, resolveDocblocksLang } from "./instance";
export type { DocblocksLang } from "./instance";
export { DocblocksI18nProvider } from "./provider";
