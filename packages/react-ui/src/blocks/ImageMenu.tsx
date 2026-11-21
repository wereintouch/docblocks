/**
 * The image figure's hover menu (top-right over the figure; the code header's
 * controls idiom — the hover reveal): the download (the resolved url, the
 * `download` attribute), the caption (the code block's caption mechanism —
 * the `caption` attr), and the three align controls
 * (`updateBlock({ align })` — "left" restores the absent attr).
 */
import { useTranslation } from "react-i18next";

import type { BlockId, ImageBlock as ImageBlockType, TextAlign } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { cn } from "../shared/ui/cn";
import { Captions, Download, TextAlignCenter, TextAlignEnd, TextAlignStart } from "../shared/ui/icons";
import { isSafeDownloadHref, preventDefault } from "../shared/utils";
import { requestBlockCaption } from "./BlockCaption";

/** The image's align controls, in display order (the format toolbar's set). */
const IMAGE_ALIGNS: { align: TextAlign; labelKey: string; icon: typeof TextAlignStart }[] = [
  { align: "left", labelKey: "align.left", icon: TextAlignStart },
  { align: "center", labelKey: "align.center", icon: TextAlignCenter },
  { align: "right", labelKey: "align.right", icon: TextAlignEnd },
];

interface ImageMenuProps {
  id: BlockId;
  block: ImageBlockType;
  url: string;
  name?: string;
}

function ImageMenu({ id, block, url, name }: ImageMenuProps) {
  const { t } = useTranslation("blocks");
  const { doc, store, viewMode } = useEditorContext();
  const align = block.attrs.align ?? "left";
  // The align's pick: the current align's press is the no-op stand
  // (it writes nothing).
  const pickAlign = (value: TextAlign) => () => {
    if (align === value) return;
    doc.updateBlock(id, { align: value });
  };

  const requestCaption = () => requestBlockCaption(store, id);

  return (
    <div
      data-slot="docblocks/image-menu"
      className={cn(
        "pointer-events-none absolute -top-9 right-0 z-20 flex items-center gap-0.5 rounded-(--docblocks-radius)",
        "p-0.5",
        "border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)",
        "bg-(--docblocks-page-card-background) shadow-(--docblocks-formatbar-shadow)",
        // The hover / focus reveal (the code header's controls idiom):
        // invisible and unclickable unless the figure is hovered or a menu
        // control holds the keyboard focus (the figure's focus-within).
        `
          opacity-0 transition-opacity
          group-focus-within:pointer-events-auto group-focus-within:opacity-100
          group-hover:pointer-events-auto group-hover:opacity-100
        `
      )}
      // Keep the caret: the menu is chrome (a default mousedown would
      // move the focus out of the editable).
      onMouseDown={preventDefault}
    >
      <Button variant="ghost" size="icon" asChild className="size-7">
        {isSafeDownloadHref(url) ? (
          <a
            href={url}
            download={name ?? block.attrs.src}
            data-slot="docblocks/image-download"
            aria-label={t("image.download")}
            title={t("image.downloadTitle")}
          >
            <Download className="size-4" />
          </a>
        ) : (
          // The executable-scheme stand (the consumer's hostile url — the
          // download stands no anchor, the disabled button stands).
          <button
            type="button"
            disabled
            data-slot="docblocks/image-download"
            aria-label={t("image.download")}
            title={t("image.downloadTitle")}
          >
            <Download className="size-4" />
          </button>
        )}
      </Button>
      {viewMode ? null : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="docblocks/image-caption-toggle"
            aria-label={block.attrs.caption ? t("caption.edit") : t("caption.add")}
            title={t("caption.aria")}
            className="size-7"
            onClick={requestCaption}
          >
            <Captions className="size-4" />
          </Button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-(--docblocks-table-border-color)" />
          {IMAGE_ALIGNS.map(({ align: value, labelKey, icon: Icon }) => {
            const label = t(labelKey);
            return (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="icon"
                data-slot="docblocks/image-align"
                data-align={value}
                data-active={align === value ? "true" : undefined}
                aria-label={label}
                title={label}
                aria-pressed={align === value}
                className={cn("size-7", align === value && "bg-accent text-accent-foreground")}
                onClick={pickAlign(value)}
              >
                <Icon className="size-4" />
              </Button>
            );
          })}
        </>
      )}
    </div>
  );
}

export { ImageMenu };
