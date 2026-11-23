/**
 * The code block's header's actions group (the right side): the copy (the
 * block's plain text over the `text/html` + `text/plain`'s payload — the
 * circle-check's feedback over the local timer, never document data), the
 * collapse (the block's clamp to the first 5 line boxes over the
 * `collapsed` attr — it syncs and survives a reload; the button is DISABLED,
 * not hidden, while the block fits in the 5 lines), the caption (seats the
 * caret on the caption line below the block), and the "more"'s dropdown (the
 * line numbers' + the wrap's toggles — both default ON over the absent attr;
 * a toggle is an `updateBlock`, the menu's open's keep over the toggle's
 * press).
 */
import { useTranslation } from "react-i18next";

import { useEffect, useRef, useState } from "react";

import type { BlockId, CodeBlock } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { Button } from "../../shared/ui/Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../shared/ui/DropdownMenu";
import {
  Captions,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  Copy,
  EllipsisVertical,
  Hash,
  TextWrap,
} from "../../shared/ui/icons";
import { textOf } from "../TextBlock";
import { requestCodeCaption } from "./CodeCaption";
import { codeBlockHtmlOf } from "./code-clipboard";

/** The copy feedback's indicator reset (the circle-check's display window). */
const COPY_RESET_MS = 1500;

interface CodeHeaderActionsProps {
  id: BlockId;
  block: CodeBlock;
  /** The "more"'s dropdown's open's state (the header's open menus' stand keeps the controls' reveal). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CodeHeaderActions({ id, block, open, onOpenChange }: CodeHeaderActionsProps) {
  const { t } = useTranslation("blocks");
  const { doc, store, viewMode } = useEditorContext();

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    []
  );

  const language = block.attrs?.language;

  /** Copy the block's content: the `text/html` payload (the rich paste's
   * `PRE → code`'s stand — the plain payload's markdown pipeline's
   * distortion's guard) + the `text/plain`'s fallback (the external app's
   * stand — the behavior stands). The block's plain text (the indentation
   * stands, no line numbers — the numbers are a rendered affordance, not
   * text). */
  const onCopy = (): void => {
    void (async () => {
      try {
        const text = textOf(block.content);
        if (typeof ClipboardItem !== "undefined") {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([codeBlockHtmlOf(text, language)], { type: "text/html" }),
              "text/plain": new Blob([text], { type: "text/plain" }),
            }),
          ]);
        } else {
          // The no-`ClipboardItem`'s engine (the legacy's stand): the
          // plain payload only (the old behavior's stand).
          await navigator.clipboard.writeText(text);
        }
        setCopied(true);
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
      } catch {
        // A refused clipboard (the no-permission / the non-secure context): the indicator stands off.
      }
    })();
  };

  const toggleCollapsed = () => doc.updateBlock(id, { collapsed: !collapsed });
  const requestCaption = () => requestCodeCaption(store, id);
  // The toggle keeps the menu open (the other toggle stands right here;
  // the menu closes on escape / outside).
  const toggleLineNumbers = (event: Event) => {
    event.preventDefault();
    doc.updateBlock(id, { lineNumbers: !lineNumbers });
  };
  const toggleWrap = (event: Event) => {
    event.preventDefault();
    doc.updateBlock(id, { wrap: !wrap });
  };

  // The display toggles read the absent attr as ON (the defaults).
  const lineNumbers = block.attrs?.lineNumbers ?? true;
  const wrap = block.attrs?.wrap ?? true;
  const collapsed = block.attrs?.collapsed === true;
  // The collapse button's enabled state: the block's LOGICAL lines (the
  // line-break count + 1) — the wrapped continuations count into their
  // logical line. A collapsed block is ALWAYS expandable (the clamp may
  // hide wrapped line boxes even at ≤5 logical lines).
  const lineCount = textOf(block.content).split("\n").length;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-slot="docblocks/code-copy"
        data-copied={copied ? "true" : undefined}
        aria-label={t("code.copy")}
        title={t("common:copy")}
        className="size-7 text-[length:inherit]"
        onClick={onCopy}
      >
        {copied ? <CircleCheck className="size-4" /> : <Copy className="size-4" />}
      </Button>
      {viewMode ? null : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="docblocks/code-collapse"
            aria-label={collapsed ? t("code.expand") : t("code.collapse")}
            aria-expanded={!collapsed}
            title={collapsed ? t("code.expandTitle") : t("code.collapseTitle")}
            className="size-7 text-[length:inherit]"
            // Disabled (not hidden) while the block fits in the clamp and is
            // not already collapsed (a collapsed block always expands).
            disabled={!collapsed && lineCount <= 5}
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="docblocks/code-caption-toggle"
            aria-label={block.attrs?.caption ? t("caption.edit") : t("caption.add")}
            title={t("caption.aria")}
            className="size-7 text-[length:inherit]"
            onClick={requestCaption}
          >
            <Captions className="size-4" />
          </Button>
          <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-slot="docblocks/code-more"
                aria-label={t("code.options")}
                title={t("common:moreOptions")}
                className="
                  size-7 text-[length:inherit]
                  data-[state=open]:bg-accent data-[state=open]:text-accent-foreground
                "
              >
                <EllipsisVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              data-slot="docblocks/code-more-menu"
              aria-label={t("code.options")}
            >
              <DropdownMenuCheckboxItem
                checked={lineNumbers}
                data-code-option="lineNumbers"
                onSelect={toggleLineNumbers}
              >
                <Hash className="size-4" />
                {t("code.lineNumbers")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={wrap} data-code-option="wrap" onSelect={toggleWrap}>
                <TextWrap className="size-4" />
                {t("code.wrap")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </>
  );
}

export { CodeHeaderActions };
