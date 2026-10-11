/**
 * docblocks-react-ui/motion — the animated editor view.
 *
 * framer-motion is an optional peer dependency and is imported only from
 * this subpath: the base entry (`docblocks-react-ui`) never imports it,
 * so a consumer without the package ships zero extra weight.
 *
 * `MotionEditor` is a drop-in replacement for the base `Editor` under the
 * same `EditorProvider` — the same root element (the focus/keyboard
 * scope), the same block rendering and editing wiring, and the same
 * presence overlay. The top-level block list renders through
 * `AnimatePresence` (`popLayout`): an inserted entry fades in as its
 * height grows, a removed one fades out as it collapses, and `layout`
 * reflows the siblings while an entry enters, exits, or the order
 * changes.
 *
 * v1 scope: the root list only — nested list items and table-cell
 * children animate plain. A list group is keyed by its first id, so a
 * group whose head is unchanged reflows without an item-level exit
 * animation; removing the head re-animates the whole group.
 *
 * The exit animation pops the leaving entry out of layout (popLayout)
 * against the editor root's `position: relative` — import the package
 * stylesheet (or an equivalent positioned editor root) for the exit to
 * anchor inside the editor.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useStore } from "zustand";

import { useMemo } from "react";

import { useEditorContext } from "../EditorProvider";
import { BlockView, groupChildren } from "../blocks/BlockView";
import { BlockContext } from "../blocks/block-context";
import { useEditing } from "../editing/useEditing";
import { PresenceCaretOverlay } from "../presence/presence-caret";

/**
 * The enter/exit geometry of a top-level entry. The spacing margin
 * collapses on exit so a leaving entry does not keep its gap.
 */
const ENTER = { opacity: 0, height: 0 } as const;
const ANIMATE = { opacity: 1, height: "auto" } as const;
const EXIT = { opacity: 0, height: 0, marginBottom: 0 } as const;

function MotionEditor() {
  const { doc, store } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const blocks = useStore(store, (state) => state.blocks);
  const rootContext = useMemo(() => ({ parentId: doc.meta.id, siblings: rootChildren }), [doc, rootChildren]);
  const { rootRef, onKeyDown } = useEditing();
  const groups = useMemo(() => groupChildren(rootChildren, blocks), [rootChildren, blocks]);

  return (
    <div ref={rootRef} data-slot="docblocks/editor" tabIndex={-1} onKeyDown={onKeyDown}>
      <BlockContext.Provider value={rootContext}>
        <AnimatePresence initial={false} mode="popLayout">
          {groups.map((group) => {
            if (group.kind === "single") {
              return (
                <motion.div key={group.id} layout initial={ENTER} animate={ANIMATE} exit={EXIT}>
                  <BlockView id={group.id} />
                </motion.div>
              );
            }
            const key = `list-${group.ids[0]}`;
            const items = group.ids.map((childId) => <BlockView key={childId} id={childId} />);
            return group.tag === "ol" ? (
              <motion.ol
                key={key}
                layout
                initial={ENTER}
                animate={ANIMATE}
                exit={EXIT}
                data-slot="docblocks/list"
                data-list={group.list}
              >
                {items}
              </motion.ol>
            ) : (
              <motion.ul
                key={key}
                layout
                initial={ENTER}
                animate={ANIMATE}
                exit={EXIT}
                data-slot="docblocks/list"
                data-list={group.list}
              >
                {items}
              </motion.ul>
            );
          })}
        </AnimatePresence>
        <PresenceCaretOverlay rootRef={rootRef} />
      </BlockContext.Provider>
    </div>
  );
}

export { MotionEditor };
