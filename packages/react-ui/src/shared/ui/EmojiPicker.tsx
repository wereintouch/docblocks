/**
 * The avatar emoji picker (the document avatar's popover content): a grid of
 * the curated catalog's emoji over a clear option. Presentational — the pick
 * and the clear report to the caller (the commit is one command: one undo
 * step, one wire update). It stands the standard theme tokens (the popover
 * content is portaled outside the editor root, where the `--docblocks-*`
 * tokens are not mapped).
 */
import { useTranslation } from "react-i18next";

import { DocblocksI18nProvider } from "../../i18n";
import { Button } from "./Button";
import { cn } from "./cn";
import { AVATAR_EMOJI } from "./emoji-catalog";

interface EmojiPickerProps {
  /** The standing avatar (the highlighted option); null / undefined when absent. */
  selected: string | null;
  /** Report an emoji pick. */
  onPick: (emoji: string) => void;
  /** Report the clear (remove the avatar). */
  onClear: () => void;
}

/** The picker's i18n scope: the package's instance stands the provider's seat
 *  over the picker (it stands also outside the editor's scope). */
function EmojiPicker(props: EmojiPickerProps) {
  return (
    <DocblocksI18nProvider>
      <EmojiPickerInner {...props} />
    </DocblocksI18nProvider>
  );
}

function EmojiPickerInner({ selected, onPick, onClear }: EmojiPickerProps) {
  const { t } = useTranslation("editor");
  const pickEmoji = (emoji: string) => () => onPick(emoji);

  return (
    <div data-slot="docblocks/emoji-picker" className="flex w-52 flex-col gap-2">
      <div role="group" aria-label={t("shared.emojiPickerGroup")} className="grid grid-cols-6 gap-1">
        {AVATAR_EMOJI.map(({ emoji, label }) => {
          const isSelected = selected === emoji;
          return (
            <Button
              key={label}
              type="button"
              variant="ghost"
              size="icon"
              data-slot="docblocks/emoji-picker-option"
              data-emoji={emoji}
              aria-label={label}
              aria-pressed={isSelected}
              title={label}
              className={cn(
                `
                  size-8 text-base text-foreground transition-colors
                  hover:text-foreground
                  focus-visible:ring-0 focus-visible:outline-1 focus-visible:outline-ring
                `,
                isSelected && "bg-accent"
              )}
              onClick={pickEmoji(emoji)}
            >
              {emoji}
            </Button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        data-slot="docblocks/emoji-picker-clear"
        className="
          -mx-1 h-auto px-2 py-1 text-left text-xs font-normal text-muted-foreground transition-colors
          focus-visible:ring-0 focus-visible:outline-1 focus-visible:outline-ring
        "
        onClick={onClear}
      >
        {t("shared.removeAvatar")}
      </Button>
    </div>
  );
}

export { EmojiPicker };
