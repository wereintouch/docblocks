/**
 * The document header's avatar slot: the emoji picker's popover over the
 * edit's mode, the display-only stand over the read-only ones. The library
 * owns the wrapper (the button over the edit's mode, the span over the
 * read-only stands), the picker, and the accessible names; the consumer may
 * replace the slot's content and stand the document avatar elsewhere
 * (the slot is hidden by the header's own prop).
 *
 * The slot stands the standard theme tokens (not the `--docblocks-*` ones):
 * the header renders in the consumer's chrome, outside the editor root
 * where the `--docblocks-*` tokens are not mapped.
 */
import { useTranslation } from "react-i18next";

import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "./shared/ui/Button";
import { EmojiPicker } from "./shared/ui/EmojiPicker";
import { Popover, PopoverContent, PopoverTrigger } from "./shared/ui/Popover";
import { cn } from "./shared/ui/cn";
import { preventDefault } from "./shared/utils";

/** The content replacement's context: the standing avatar (`null` — none)
 *  and the interaction's stand (`false` over the read-only modes — the
 *  picker is off and the content is the consumer's display-only view). */
interface DocHeaderAvatarContentContext {
  /** The avatar to stand (`meta.avatar`); `null` — the document has none. */
  avatar: string | null;
  /** `false` over the read-only modes: the slot's content is display-only. */
  editable: boolean;
}

/** The avatar slot's props: the standing value, the edit's stand, and the
 *  consumer's content replacement. */
interface DocHeaderAvatarProps {
  /** The standing avatar; `null` — none. */
  avatar: string | null;
  /** The picker's popover over `true`; the display-only span over `false`. */
  editable: boolean;
  /** The consumer's content replacement (the wrapper, the picker, and the
   *  accessible names stay the library's). */
  renderContent?: (context: DocHeaderAvatarContentContext) => ReactNode;
  /** The pick's commit (the header writes `setAvatar`). */
  onPick: (emoji: string) => void;
  /** The clear's commit (the header writes `setAvatar(null)`). */
  onClear: () => void;
}

/** The read-only slot's frame: the span owns its content's centring. */
const READONLY_SLOT_CLASS =
  "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-base font-normal";

/** The interactive slot's frame: the button centres its own content. */
const EDITABLE_SLOT_CLASS = "size-8 shrink-0 overflow-hidden rounded-full text-base font-normal";

/** The filled / the empty stand: an absent avatar reads as the placeholder's
 *  affordance (the dashed ring). */
function avatarStateClass(avatar: string | null): string {
  return avatar ? "bg-muted" : "border border-dashed border-input text-muted-foreground";
}

function DocHeaderAvatar({ avatar, editable, renderContent, onPick, onClear }: DocHeaderAvatarProps) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  // The consumer's content stands on every render (the callback is not
  // memoized by the library); the built-in render is the emoji over the
  // standing value, the "+" affordance (the edit's mode) or nothing (the
  // read-only's stand) otherwise.
  const content = renderContent ? renderContent({ avatar, editable }) : (avatar ?? (editable ? "+" : ""));

  const pick = (emoji: string) => {
    onPick(emoji);
    setOpen(false);
  };
  const clear = () => {
    onClear();
    setOpen(false);
  };

  if (!editable) {
    return (
      <span
        data-slot="docblocks/doc-header-avatar"
        aria-label={t("docHeader.documentAvatarAria")}
        className={cn(READONLY_SLOT_CLASS, avatarStateClass(avatar))}
      >
        {content}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-slot="docblocks/doc-header-avatar"
          aria-label={t("docHeader.editAvatarAria")}
          title={t("docHeader.editAvatar")}
          className={cn(EDITABLE_SLOT_CLASS, avatarStateClass(avatar))}
        >
          {content}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} onOpenAutoFocus={preventDefault} className="w-auto p-2.5">
        <EmojiPicker selected={avatar} onPick={pick} onClear={clear} />
      </PopoverContent>
    </Popover>
  );
}

export { DocHeaderAvatar };
export type { DocHeaderAvatarContentContext };
