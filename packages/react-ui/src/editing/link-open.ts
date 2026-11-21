/** The link href's open stand (the contenteditable's anchor's gap): the
 * browser cancels the anchor's navigation default inside a contenteditable
 * (the caret's seat stands — the mousedown's default), so the editor opens
 * the href itself. The decision stands the href's class (the core's
 * `linkHrefKindOf`'s classifier over the normalized form): the web's URL
 * stands the new tab's open (`noopener,noreferrer` — the gesture's window's
 * call, the popup's block's off), the `mailto` / `tel` / the relative's
 * forms stand the same-tab's navigation (the browser's scheme's handler —
 * the mail client / the dialer — and the relative's page's navigation; the
 * `window.open`'s call stands no `mailto` in the Chromium family). */
import { linkHrefKindOf } from "docblocks-core";

/** The open's tab stand over the href's class. */
type LinkOpenTarget = "new-tab" | "same-tab";

/** The open's tab stand over the href's class (the core's classifier —
 *  the web's URL stands the new tab, the other safe forms stand the same
 *  tab); `null` over any href outside the safe contract (the open's
 *  rejection — the anchor reaching the open from a consumer's renderer is
 *  as untrusted as any document content). */
const linkOpenTargetOf = (href: string): LinkOpenTarget | null => {
  const kind = linkHrefKindOf(href);
  if (kind === null) return null;
  return kind === "web" ? "new-tab" : "same-tab";
};

/** The href's open over the tab stand (the new tab's `window.open`'s call,
 *  the same tab's `location.assign`'s navigation). An href outside the
 *  safe contract navigates nowhere. */
const openLinkHref = (href: string): void => {
  const target = linkOpenTargetOf(href);
  if (target === null) return;
  if (target === "new-tab") window.open(href, "_blank", "noopener,noreferrer");
  else window.location.assign(href);
};

export { openLinkHref, linkOpenTargetOf };
export type { LinkOpenTarget };
