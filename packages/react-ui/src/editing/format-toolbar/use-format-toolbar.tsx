/** The editor-level format toolbar layer (null while no eligible range is
 * selected). */
import type { ReactNode, RefObject } from "react";

import { FormatToolbar } from "./FormatToolbar";

function useFormatToolbar(
  rootRef: RefObject<HTMLElement | null>,
  palette: readonly string[]
): {
  toolbarNode: ReactNode;
} {
  return { toolbarNode: <FormatToolbar rootRef={rootRef} palette={palette} /> };
}

export { useFormatToolbar };
