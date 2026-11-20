/** The cross-drag's models: the seated text position, the live press
 *  session, and the session's window listeners. */
import type { BlockId } from "docblocks-core";

/** The text position under the pointer (the selection's endpoint). */
interface DragPosition {
  blockId: BlockId;
  node: Node;
  offset: number;
}

/** The live session of one mouse press. */
interface CrossDragSession {
  pointerId: number;
  anchor: DragPosition;
  moved: boolean;
  /** The last pointer position the selection was seated on. */
  last: DragPosition | null;
}

/** The session's window listeners (stable for the hook's lifetime). */
interface CrossDragHandlers {
  move: (event: WindowEventMap["pointermove"]) => void;
  end: (event: WindowEventMap["pointerup"]) => void;
  mousedown: (event: MouseEvent) => void;
}

export type { CrossDragHandlers, CrossDragSession, DragPosition };
