/** The link editor's floating popover: the one field (the address's input
 * over the smart scheme's inference — the `resolve`'s unit) + the
 * remove's button (over the linked's target's stand). A plain
 * absolutely-positioned div inside the editor root (the root is the
 * positioning context), like the slash / the mention's menus. Enter / the
 * apply stands the commit (the `applyLinkHref`'s one transaction), the
 * Escape stands the close (the no-write's stand — the document's stand
 * over the input's no-focus's, the LinkMenu's parity), the invalid's stand
 * stands the destructive's border + the message. The popover's mousedown
 * stands the default's suppress (the selection's life over the edit) over
 * the non-form-control's stand only — the input's press keeps its default
 * (the focus + the caret's seat, the typing's stand over a lost focus).
 * The outside's press stands the close (the capture's document's stand,
 * the LinkMenu's parity).
 */
import { useTranslation } from "react-i18next";

import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

import { useEditorContext } from "../../editor-provider";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { cn } from "../../shared/ui/cn";
import { Trash } from "../../shared/ui/icons";
import { clamp, preventDefault } from "../../shared/utils";
import { applyLinkHref, removeLink } from "./actions";
import type { LinkPopoverState } from "./models";
import { uniformLinkHrefOf } from "./range";
import { resolveLinkHref } from "./resolve";

/** The popover's width (px — the input's field's stand). */
const POPOVER_WIDTH_PX = 288;
/** The anchor's offset from the popover's edge (px — the flip's margin). */
const ANCHOR_OFFSET_PX = 8;

interface LinkPopoverProps {
  rootRef: RefObject<HTMLElement | null>;
  state: LinkPopoverState;
  onClose: () => void;
}

function LinkPopover({ rootRef, state, onClose }: LinkPopoverProps) {
  const { t } = useTranslation("editor");
  const { doc } = useEditorContext();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(state.prefilledHref ?? "");
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const canRemove = state.prefilledHref !== null || uniformLinkHrefOf(doc, state.target) !== null;

  // The input's focus + the selection (the prefill's edit's stand) over the
  // mount (the first frame stands hidden over the position's measure).
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, []);

  // The close's explicit's paths (the LinkMenu's parity over the popover's
  // gap): the outside's pointerdown (the capture's document's stand over
  // the popover's own press's exclusion) + the Escape (the capture's
  // document's stand — the input's own key's no-double's stand over it).
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const el = popoverRef.current;
      const target = event.target instanceof Element ? event.target : null;
      if (el !== null && target !== null && !el.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  // The form control's press stands the default's stand (the input's focus
  // + the caret's seat over the click — the suppression would keep a lost
  // focus on the body / the doc, and the typing would land nowhere / in
  // the doc). The other's stands the selection's life over the edit (the
  // button's / the padding's press's no-clobber).
  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target !== null && target.closest("input, textarea") !== null) return;
    preventDefault(event);
  };

  // Anchor at the open's point (below it, over the above's flip when there
  // is no room), clamped inside the editor root (measured over the layout
  // effect — the first frame stands hidden).
  useLayoutEffect(() => {
    const el = popoverRef.current;
    const root = rootRef.current;
    if (el === null || root === null) return;
    const rootRect = root.getBoundingClientRect();
    const height = el.offsetHeight;
    const left = clamp(
      state.anchor.x,
      ANCHOR_OFFSET_PX,
      Math.max(ANCHOR_OFFSET_PX, rootRect.width - POPOVER_WIDTH_PX - ANCHOR_OFFSET_PX)
    );
    const below = state.anchor.y + ANCHOR_OFFSET_PX;
    const top =
      below + height > rootRect.height ? Math.max(ANCHOR_OFFSET_PX, state.anchor.y - height - ANCHOR_OFFSET_PX) : below;
    setPosition({ left, top });
  }, [state.anchor, rootRef]);

  const apply = () => {
    const href = resolveLinkHref(value);
    if (href === null) {
      setInvalid(true);
      return;
    }
    applyLinkHref(doc, state.target, href, value.trim());
    onClose();
  };

  const remove = () => {
    removeLink(doc, state.target);
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      data-slot="docblocks/link-popover"
      aria-label={t("link.aria")}
      className={cn(
        "absolute z-modal rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md",
        position === null && "opacity-0"
      )}
      style={
        position === null
          ? { width: POPOVER_WIDTH_PX }
          : { width: POPOVER_WIDTH_PX, left: position.left, top: position.top }
      }
      onMouseDown={handleMouseDown}
    >
      <Input
        ref={inputRef}
        data-slot="docblocks/link-popover-input"
        size="sm"
        value={value}
        placeholder={t("link.placeholder")}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          // The no-bubble's stand over the editor root's keys (the Enter's
          // line-break's double-fire's off — the popover's commit's stand
          // only). The Escape stands the document's stand over the capture
          // (the single's owner's stand — the input's own key's no-double).
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            apply();
          }
        }}
      />
      {invalid && (
        <div data-slot="docblocks/link-popover-invalid" className="px-2 pt-1 text-xs text-destructive">
          {t("link.invalid")}
        </div>
      )}
      {canRemove && (
        <Button
          data-slot="docblocks/link-popover-remove"
          variant="ghost"
          size="sm"
          className="mt-1.5 h-7 w-full justify-start gap-1.5 px-2 text-xs text-destructive"
          onClick={remove}
        >
          <Trash className="size-3.5" />
          {t("link.remove")}
        </Button>
      )}
    </div>
  );
}

export { LinkPopover };
