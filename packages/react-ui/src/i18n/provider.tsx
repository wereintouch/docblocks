import { I18nextProvider } from "react-i18next";

import type { ReactNode } from "react";

import { docblocksI18n } from "./instance";

/**
 * The docblocks' i18n scope: the package's own i18next instance over the
 * subtree — the docblocks' `useTranslation` resolves against it and never
 * conflicts with the consumer's global i18next singleton (the instance's
 * isolation). The `EditorProvider` and the consumer-placed `DocHeader`
 * both wrap over it.
 */
function DocblocksI18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={docblocksI18n}>{children}</I18nextProvider>;
}

export { DocblocksI18nProvider };
