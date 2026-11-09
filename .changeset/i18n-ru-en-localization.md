"docblocks-react-ui": minor
---

The editor's UI strings stand localized (en + ru). The language is
consumer-driven: the package reads the `<html lang>` attribute (the `ru*`
prefix stands the Russian stand; the absent or unknown language falls
back to English) and follows the attribute's change at runtime. There is
no `locale` prop.

The package runs its own `i18next` instance over the shipped catalogs —
`i18next` and `react-i18next` are new runtime dependencies — under the
`EditorProvider`'s subtree (and the consumer-placed `DocHeader`): the
consumer's global `i18next` singleton stands untouched, and the editor's
`useTranslation` never conflicts with it. The English's values keep the
former's literals as-is (the zero visual diff over the English's
language).

Not localized (the technical stand): the code language's names, the font
family's and weight's names, the avatar emoji picker's accessible names,
and the technical glyphs. Parameterized strings use the `{param}`
interpolation (the single braces' stand).
