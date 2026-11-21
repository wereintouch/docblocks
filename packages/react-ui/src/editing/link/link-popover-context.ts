/** The link popover's api's context (the editor-level's opener over the
 * selection and the explicit anchor — the format toolbar's button reads
 * it; the provider stands in the editor's root subtree). */
import { createContext, useContext } from "react";

import type { LinkPopoverApi } from "./models";

const LinkPopoverContext = createContext<LinkPopoverApi | null>(null);

/** The link popover's api over the provider (`null` over the provider's
 * absence — the link's affordances' stand is off). */
function useLinkPopoverApi(): LinkPopoverApi | null {
  return useContext(LinkPopoverContext);
}

export { LinkPopoverContext, useLinkPopoverApi };
