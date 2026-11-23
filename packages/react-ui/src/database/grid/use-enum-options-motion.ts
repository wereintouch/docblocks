/** The enum's options editor's motion's slot: the framer-wired editor
 * (the Reorder's rows) provides the motion's variant here; the renderer
 * without the slot stands the plain editor. framer-motion stands the
 * required peer (the base entry's row layer — the import is the base's). */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { EnumOptionDraft } from "./models";

type EnumOptionsMotionEditor = (props: {
  options: EnumOptionDraft[];
  onChange: (next: EnumOptionDraft[]) => void;
}) => ReactNode;

const EnumOptionsMotionSlot = createContext<EnumOptionsMotionEditor | null>(null);

function useEnumOptionsMotion(): EnumOptionsMotionEditor | null {
  return useContext(EnumOptionsMotionSlot);
}

export { EnumOptionsMotionSlot, useEnumOptionsMotion };
export type { EnumOptionsMotionEditor };
