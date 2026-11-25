/**
 * The open menu's structural guard: a concurrent structural change (a peer's
 * insert / remove / move) invalidates the menu's index-based anchor, so the
 * menu closes (a re-anchored chip would act on the wrong target; a local
 * action closes the menu before the doc changes, so this fires on concurrent
 * changes only).
 */
import { useLayoutEffect, useRef } from "react";

function useTableStructureGuard(structureKey: string, open: boolean, close: () => void): void {
  const previous = useRef(structureKey);
  useLayoutEffect(() => {
    if (open && previous.current !== structureKey) close();
    previous.current = structureKey;
  }, [structureKey, open, close]);
}

export { useTableStructureGuard };
