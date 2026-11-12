---
"docblocks-react-ui": patch
---

The `DocblocksI18nProvider` (exported from the package entry) accepts an
optional `locale` prop: the controlled mode for server-rendered
consumers, where the `<html lang>` read is unavailable on the server and
the first client render would take a different language (the hydration
mismatch). The passed locale is normalized over the existing rules
(`ru*` → `ru`, `en*` / unknown / empty → `en`), the provider creates its
own synchronously initialized `i18next` instance keyed by the normalized
value (a locale change selects the new instance and re-renders the
subtree), and a nested provider without a `locale` inherits the outer's
instance. The controlled mode never mutates the legacy attribute-driven
instance and never touches the consumer's global `i18next`, so
concurrent subtrees over different locales stay isolated; the locale is
UI state only. Outside a controlled provider, the attribute-driven
behavior is unchanged.
