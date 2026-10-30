/** The mention picker's context: the api at the nearest editor root
 *  (null = the mention is disabled — no provider on the root). */
import { createContext, useContext } from "react";

import type { MentionMenuApi } from "./models";

const MentionMenuContext = createContext<MentionMenuApi | null>(null);

/** The mention picker api for the nearest editor root (null = mention disabled). */
function useMentionMenuApi(): MentionMenuApi | null {
  return useContext(MentionMenuContext);
}

export { MentionMenuContext, useMentionMenuApi };
