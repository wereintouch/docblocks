/** The mention picker's floating popover: the two sections (people +
 *  documents) over the consumer's mention provider, anchored at the `@`
 *  character. A plain absolutely-positioned div inside the editor root
 *  (the root is the positioning context), like the slash menu. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { MentionEntry } from "../../EditorProvider";
import { useBlock } from "../../hooks";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { cn } from "../../shared/ui/cn";
import { locatePosition } from "../dom-offset";
import { blockTextOf, liveCaretOf, slashInnerOf } from "../slash/utils";
import type { MentionDerivation, MentionMenuProps, MentionPick } from "./models";
import { deriveMention } from "./utils";

/** The debounce between the query change and the search request. */
const SEARCH_DEBOUNCE_MS = 120;

type MentionResult = { users: MentionEntry[]; docs: MentionEntry[] };

function MentionMenu(props: MentionMenuProps) {
  const { rootRef, state, provider, active, onItemsChange, onHover, onPick, onClose } = props;
  const block = useBlock(state.blockId);
  const text = blockTextOf(block);

  // The live derivation (the block text from the store + the caret from the
  // DOM selection). A closed derivation (the `@` deleted, or the caret out
  // of the window) is a no-op close.
  const [derived, setDerived] = useState<MentionDerivation | null>(null);
  useLayoutEffect(() => {
    const caret = liveCaretOf(rootRef, state.blockId, state.atOffset + 1);
    const derivation = deriveMention(text, state.atOffset, caret);
    setDerived(derivation);
    if (derivation.closed) onClose();
  }, [text, state, rootRef, onClose]);

  // The search: fetch the two sections for the live query (debounced, and
  // raced — a newer query wins; a refused / failed request stands an empty
  // section). Re-fetches on every query change.
  const [result, setResult] = useState<MentionResult>({ users: [], docs: [] });
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  useEffect(() => {
    if (provider === null || derived === null || derived.closed) return;
    const query = derived.query;
    const request = (requestRef.current += 1);
    const timer = setTimeout(() => {
      setLoading(true);
      const settled = Promise.all([
        provider.searchUsers(query).catch(() => [] as MentionEntry[]),
        provider.searchDocs(query).catch(() => [] as MentionEntry[]),
      ])
        .then(([users, docs]) => {
          if (request !== requestRef.current) return; // a newer query won the race
          setResult({ users, docs });
          setLoading(false);
        })
        .catch(() => {
          if (request === requestRef.current) setLoading(false);
        });
      void settled;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [provider, derived]);

  // The flattened items (people, then documents) the hook navigates.
  const items: MentionPick[] =
    derived === null || derived.closed
      ? []
      : [
          ...result.users.map((u): MentionPick => ({ kind: "user", id: u.id, label: u.label })),
          ...result.docs.map((d): MentionPick => ({ kind: "doc", id: d.id, label: d.label })),
        ];
  useLayoutEffect(() => {
    onItemsChange(items);
  }, [items, onItemsChange]);

  const usersCount = result.users.length;
  // The picker stands while the `@` phrase stands (the derivation open):
  // the sections over a non-empty result, the loading stand while the fetch
  // runs, and the empty stand (the "No matches") over an empty one.
  const visible = derived !== null && !derived.closed;
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));

  // Anchor at the `@` character (below the line, or above it on the flip),
  // measured in a layout effect (the first frame stands hidden).
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null);
      return;
    }
    const root = rootRef.current;
    const inner = slashInnerOf(rootRef, state.blockId);
    if (root === null || inner === null) return;
    const start = locatePosition(inner, state.atOffset);
    const end = locatePosition(inner, state.atOffset + 1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (typeof range.getBoundingClientRect !== "function") return;
    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const left = rect.left - rootRect.left;
    const height = menuRef.current?.offsetHeight ?? 0;
    if (rect.bottom + height + 8 > window.innerHeight) {
      setPosition({ left, bottom: rootRect.bottom - rect.top });
    } else {
      setPosition({ left, top: rect.bottom - rootRect.top });
    }
  }, [visible, state.blockId, state.atOffset, text, rootRef]);

  // The keyboard-navigated active item stands visible inside the bounded
  // list (the minimal scroll; jsdom has no scrollIntoView — the guard stands).
  useLayoutEffect(() => {
    if (!visible || position === null) return;
    const activeEl = menuRef.current?.querySelector<HTMLElement>("[data-slot='docblocks/mention-item'][data-active]");
    activeEl?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, visible, position]);

  if (!visible) return null;

  const renderItem = (item: MentionPick, index: number) => (
    <div
      key={`${item.kind}-${item.id}`}
      role="menuitem"
      data-slot="docblocks/mention-item"
      data-active={index === activeIndex || undefined}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none",
        index === activeIndex && "bg-accent text-accent-foreground"
      )}
      onMouseEnter={() => onHover(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(item)}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          item.kind === "user" ? "bg-(--docblocks-mention-color)" : "bg-(--docblocks-placeholder-color)"
        )}
      />
      <span className="truncate">{item.label}</span>
    </div>
  );

  return (
    <ScrollArea
      ref={menuRef}
      role="menu"
      data-slot="docblocks/mention-menu"
      className={cn(
        "absolute z-modal max-h-80 w-64 overflow-x-hidden rounded-md border border-border bg-popover p-1",
        "text-popover-foreground shadow-md",
        position === null && "opacity-0"
      )}
      style={
        position === null
          ? undefined
          : {
              left: position.left,
              ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
            }
      }
    >
      {loading && items.length === 0 ? (
        <div data-slot="docblocks/mention-loading" className="px-2 py-1.5 text-sm text-muted-foreground">
          Searching…
        </div>
      ) : (
        <>
          {result.users.length > 0 && (
            <div data-slot="docblocks/mention-users" className="p-1">
              <div className="px-2 py-1 text-xs text-muted-foreground select-none">People</div>
              {result.users.map((u, i) => renderItem({ kind: "user", id: u.id, label: u.label }, i))}
            </div>
          )}
          {result.docs.length > 0 && (
            <div data-slot="docblocks/mention-docs" className="p-1">
              <div className="px-2 py-1 text-xs text-muted-foreground select-none">Documents</div>
              {result.docs.map((d, i) => renderItem({ kind: "doc", id: d.id, label: d.label }, usersCount + i))}
            </div>
          )}
          {items.length === 0 && !loading && (
            <div data-slot="docblocks/mention-empty" className="px-2 py-1.5 text-sm text-muted-foreground">
              No matches
            </div>
          )}
        </>
      )}
    </ScrollArea>
  );
}

export { MentionMenu as MentionPicker };
