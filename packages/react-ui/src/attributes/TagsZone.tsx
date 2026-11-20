// The tags row's value zone (the consumer-owned `docTags`'s stand): the
// chips over the passed list + the add affordance (the consumer's own
// creation's UI over the click — the package opens nothing) + the chip's
// removal. The tags are never document data (no write, no undo, no wire)
// — the consumer's store is the source and the callbacks are the full
// event surface (the add's request / the removal / the chip's click).
import { useTranslation } from "react-i18next";

import type { MouseEvent as ReactMouseEvent } from "react";

import type { DocTag } from "../editor-provider";
import { cn } from "../shared/ui/cn";
import { Plus, X } from "../shared/ui/icons";

/** The tags zone's props (the panel's pass-through over the `docTags`'s
 *  contract + the read-only stand). */
function TagsZone({
  tags,
  readOnly,
  onTagAdd,
  onTagRemove,
  onTagClick,
}: {
  tags: readonly DocTag[];
  readOnly: boolean;
  onTagAdd?: () => void;
  onTagRemove?: (tag: DocTag) => void;
  onTagClick?: (tag: DocTag, event: MouseEvent) => void;
}) {
  const { t } = useTranslation("editor");

  // The empty's stand (the no-tags' list): the add affordance over the
  // edit mode (the consumer's creation's entry), the placeholder over
  // the display-only stands (the read-only / the absent onTagAdd).
  if (tags.length === 0) {
    if (readOnly || onTagAdd === undefined) {
      return <span className="text-sm text-muted-foreground">{t("attributes.notSet")}</span>;
    }
    return (
      <button
        type="button"
        data-slot="docblocks/attributes-tag-add"
        aria-label={t("attributes.addTagAria")}
        className="
          flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground
          hover:bg-muted/50 hover:text-foreground
        "
        onClick={() => onTagAdd()}
      >
        <Plus className="size-3" />
        {t("attributes.addTag")}
      </button>
    );
  }

  return (
    <div data-slot="docblocks/attributes-tags" className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          data-slot="docblocks/attributes-tag"
          data-tag-id={tag.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs",
            onTagClick !== undefined && "cursor-pointer"
          )}
          onClick={
            onTagClick !== undefined ? (event: ReactMouseEvent) => onTagClick(tag, event.nativeEvent) : undefined
          }
        >
          {tag.label}
          {readOnly || onTagRemove === undefined ? null : (
            <button
              type="button"
              data-slot="docblocks/attributes-tag-remove"
              aria-label={t("attributes.removeAria", { name: tag.label })}
              className="text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                // The removal's own event: the chip's click (the
                // consumer's navigation's stand) stays out.
                event.stopPropagation();
                onTagRemove(tag);
              }}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {readOnly || onTagAdd === undefined ? null : (
        <button
          type="button"
          data-slot="docblocks/attributes-tag-add"
          aria-label={t("attributes.addTagAria")}
          className="
            flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground
            hover:bg-muted/50 hover:text-foreground
          "
          onClick={() => onTagAdd()}
        >
          <Plus className="size-3" />
          {t("attributes.addTag")}
        </button>
      )}
    </div>
  );
}

export { TagsZone };
