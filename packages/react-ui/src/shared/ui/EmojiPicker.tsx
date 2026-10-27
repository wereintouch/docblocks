/**
 * The avatar emoji picker (the document avatar's popover content): a grid of
 * the curated catalog's emoji over a clear option. Presentational — the pick
 * and the clear report to the caller (the commit is one command: one undo
 * step, one wire update). It stands the standard theme tokens (the popover
 * content is portaled outside the editor root, where the `--docblocks-*`
 * tokens are not mapped).
 */
import { cn } from "./cn";
import { AVATAR_EMOJI } from "./emoji-catalog";

function EmojiPicker({
  selected,
  onPick,
  onClear,
}: {
  /** The standing avatar (the highlighted option); null / undefined when absent. */
  selected: string | null;
  /** Report an emoji pick. */
  onPick: (emoji: string) => void;
  /** Report the clear (remove the avatar). */
  onClear: () => void;
}) {
  return (
    <div data-slot="docblocks/emoji-picker" className="flex w-52 flex-col gap-2">
      <div role="group" aria-label="Avatar emoji" className="grid grid-cols-6 gap-1">
        {AVATAR_EMOJI.map(({ emoji, label }) => {
          const isSelected = selected === emoji;
          return (
            <button
              key={label}
              type="button"
              data-slot="docblocks/emoji-picker-option"
              data-emoji={emoji}
              aria-label={label}
              aria-pressed={isSelected}
              title={label}
              className={cn(
                `
                  flex size-8 items-center justify-center rounded-md text-base transition-colors
                  hover:bg-accent
                  focus-visible:outline-1 focus-visible:outline-ring
                `,
                isSelected && "bg-accent"
              )}
              onClick={() => onPick(emoji)}
            >
              {emoji}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        data-slot="docblocks/emoji-picker-clear"
        className="
          -mx-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors
          hover:bg-accent hover:text-foreground
          focus-visible:outline-1 focus-visible:outline-ring
        "
        onClick={onClear}
      >
        Remove avatar
      </button>
    </div>
  );
}

export { EmojiPicker };
