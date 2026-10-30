/** The slash menu's context: the api provider + the consumer hook (the
 *  blocks read the menu state through it). */
import { createContext, useContext } from "react";

import type { SlashMenuApi } from "./models";

const SlashMenuContext = createContext<SlashMenuApi | null>(null);

/** The slash menu api for the nearest editor root (null = slash disabled). */
function useSlashMenuApi(): SlashMenuApi | null {
  return useContext(SlashMenuContext);
}

export { SlashMenuContext, useSlashMenuApi };
