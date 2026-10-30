/** The enum's options editor's motion's slot: the framer-wired editor
 * (the `./motion`'s Reorder's rows) provides the motion's variant here;
 * the base's renderer stands the plain editor (the slot stands the null's
 * stand). The base stands the context only — the framer's import stands
 * the motion's subpath (the house's boundary's contract). */
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
