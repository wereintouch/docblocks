import type { i18n as I18nInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { createDocblocksI18nInstance, docblocksI18n, normalizeDocblocksLocale } from "./instance";

/** The inherited controlled instance (the nested uncontrolled provider takes the outer one — the package's internal wrappers keep the consumer's locale without threading it through each component). */
const ControlledI18nContext = createContext<I18nInstance | null>(null);

/** The provider's props (the optional controlled locale + the children's i18n scope). */
interface DocblocksI18nProviderProps {
  /** The consumer's resolved locale (the SSR's parity: the server and the client pass the same value, so both renders take the same language from the first render — independent of the `<html lang>` attribute). */
  locale?: string;
  children: ReactNode;
}

/**
 * The docblocks' i18n scope: the package's own i18next instance over the
 * subtree — the docblocks' `useTranslation` resolves against it and never
 * conflicts with the consumer's global i18next singleton (the instance's
 * isolation). The `EditorProvider` and the consumer-placed `DocHeader`
 * both wrap over it.
 *
 * The optional `locale` prop is the controlled mode: the provider creates
 * its own synchronously initialized instance over the normalized locale
 * (one per provider, keyed by the normalized value — a locale change
 * selects the new instance and re-renders the subtree). The controlled
 * mode never mutates the legacy singleton and never calls
 * `changeLanguage` on it, so the concurrent subtrees over different
 * locales stay isolated. The provider without a locale inherits the
 * outer's controlled instance when nested over one; outside a controlled
 * provider it keeps the legacy behavior — the module-level instance
 * driven by the `<html lang>` attribute and its runtime flip.
 */
function DocblocksI18nProvider({ locale, children }: DocblocksI18nProviderProps) {
  const inherited = useContext(ControlledI18nContext);
  const normalized = locale === undefined ? null : normalizeDocblocksLocale(locale);
  const controlled = useMemo(
    () => (normalized === null ? null : createDocblocksI18nInstance(normalized)),
    [normalized]
  );
  const effective = controlled ?? inherited ?? docblocksI18n;
  return (
    <ControlledI18nContext.Provider value={controlled ?? inherited}>
      <I18nextProvider i18n={effective}>{children}</I18nextProvider>
    </ControlledI18nContext.Provider>
  );
}

export { DocblocksI18nProvider };
export type { DocblocksI18nProviderProps };
