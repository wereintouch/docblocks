import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { BlockId, CodeBlock } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { Button } from "../shared/ui/Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../shared/ui/DropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { cn } from "../shared/ui/cn";
import { Check, ChevronDown, CircleCheck, Copy, EllipsisVertical, Hash, Search, TextWrap } from "../shared/ui/icons";
import { textOf } from "./TextBlock";

/**
 * The code block's header row: the language selector on the left and the
 * copy / "more" controls on the right (the right group carries a center
 * slot between the language button and the controls).
 *
 * Visibility: the row always occupies its space (no layout shift) and its
 * strip (the row's bottom border) is revealed while the wrapper is hovered
 * or focused (the typing state); the controls themselves reveal only on a
 * hover — the typing state keeps the strip and hides the controls.
 *
 * Language: the name is always shown (default "Plain Text" — the absent
 * or empty `language` attr). The picker is a non-modal popover with a
 * search field (the typed name filters the list, Enter picks the first
 * match); a pick is an `updateBlock({ language })` (one undo step, one
 * wire update). The list is a curated base set (a consumer can override
 * the renderer for a different set).
 *
 * Copy: the block's plain text (the indentation stands, no line numbers —
 * the numbers are a rendered affordance, not text) to the clipboard; the
 * button shows the circle-check feedback for ~1.5 s (a local timer, never
 * document data).
 *
 * "More": a non-modal dropdown with the two display toggles (line numbers
 * and wrap), both default ON (the absent attr reads as on); a toggle is an
 * `updateBlock` (one undo step, one wire update).
 */

/** The curated base language set ("" = Plain Text, the default). */
const LANGUAGES: readonly { value: string; label: string }[] = [
  { value: "", label: "Plain Text" },
  { value: "bash", label: "Bash" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "css", label: "CSS" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "kotlin", label: "Kotlin" },
  { value: "markdown", label: "Markdown" },
  { value: "mermaid", label: "Mermaid" },
  { value: "php", label: "PHP" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "swift", label: "Swift" },
  { value: "toml", label: "TOML" },
  { value: "typescript", label: "TypeScript" },
  { value: "xml", label: "XML / HTML" },
  { value: "yaml", label: "YAML" },
];

/** The display label of the block's language (absent/empty = Plain Text; an unknown value shows as-is). */
function languageLabel(language: string | undefined): string {
  if (language === undefined || language === "") return "Plain Text";
  return LANGUAGES.find((lang) => lang.value === language)?.label ?? language;
}

interface CodeHeaderProps {
  id: BlockId;
  block: CodeBlock;
  /**
   * A center control between the language button and the right group (the
   * mermaid code/preview selector, rendered by the `./mermaid` subpath).
   */
  center?: ReactNode;
}

function CodeHeader({ id, block, center }: CodeHeaderProps) {
  const { doc } = useEditorContext();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    []
  );

  const language = block.attrs?.language;
  const trimmed = query.trim().toLowerCase();
  const matches = trimmed === "" ? LANGUAGES : LANGUAGES.filter((lang) => lang.label.toLowerCase().includes(trimmed));

  /** Pick a language (a no-op when the block already carries it). */
  const pickLanguage = (value: string): void => {
    setLanguageOpen(false);
    setQuery("");
    if ((language ?? "") === value) return;
    doc.updateBlock(id, { language: value });
  };

  /** Copy the block's plain text (the indentation stands, no numbers). */
  const onCopy = (): void => {
    void navigator.clipboard
      .writeText(textOf(block.content))
      .then(() => {
        setCopied(true);
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  // The display toggles read the absent attr as ON (the defaults).
  const lineNumbers = block.attrs?.lineNumbers ?? true;
  const wrap = block.attrs?.wrap ?? true;

  // The controls' hover reveal: invisible (and unclickable) unless the
  // wrapper is hovered; the row's strip stands on hover or while the
  // block is focused (the typing state — the strip stands, the controls
  // stay invisible).
  const controlClass =
    "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100";

  return (
    <div
      data-slot="docblocks/code-header"
      className="
        mb-1 flex items-center justify-between gap-2 border-b border-transparent pb-1 text-[0.8125em]
        group-focus-within:border-border
        group-hover:border-border
      "
      // Keep the caret: a default mousedown would move the focus out of the
      // editable (the controls are chrome, never the text).
      onMouseDown={(event) => event.preventDefault()}
    >
      <Popover modal={false} open={languageOpen} onOpenChange={setLanguageOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-slot="docblocks/code-language"
            aria-label="Choose the code language"
            className={cn("h-7 max-w-45 gap-1 px-2 text-[length:inherit]", controlClass)}
          >
            <span className="truncate">{languageLabel(language)}</span>
            <ChevronDown className="size-3.5 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          data-slot="docblocks/code-language-menu"
          aria-label="Code language"
          className="flex w-56 flex-col gap-2"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              data-slot="docblocks/code-language-search"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const first = matches[0];
                  if (first !== undefined) pickLanguage(first.value);
                }
              }}
              placeholder="Search language…"
              aria-label="Search language"
              className="
                h-8 w-full rounded-md border border-border bg-transparent pr-2 pl-7 text-sm outline-none
                focus:border-ring
              "
            />
          </div>
          <div role="listbox" aria-label="Languages" className="max-h-64 overflow-y-auto py-0.5">
            {matches.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No matches</div>
            ) : (
              matches.map((lang) => {
                const selected = (language ?? "") === lang.value;
                return (
                  <div
                    key={lang.value || "plain"}
                    role="option"
                    aria-selected={selected}
                    data-lang-value={lang.value || "plain"}
                    onClick={() => pickLanguage(lang.value)}
                    className="
                      flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm
                      hover:bg-accent hover:text-accent-foreground
                    "
                  >
                    <span className="truncate">{lang.label}</span>
                    {selected && <Check className="size-4 shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      <div data-slot="docblocks/code-header-actions" className={cn("flex items-center gap-0.5", controlClass)}>
        {center}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-slot="docblocks/code-copy"
          data-copied={copied ? "true" : undefined}
          aria-label="Copy the code"
          title="Copy"
          className="size-7 text-[length:inherit]"
          onClick={onCopy}
        >
          {copied ? <CircleCheck className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <DropdownMenu modal={false} open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-slot="docblocks/code-more"
              aria-label="Code options"
              title="More options"
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
            aria-label="Code options"
          >
            <DropdownMenuCheckboxItem
              checked={lineNumbers}
              data-code-option="lineNumbers"
              onSelect={(event) => {
                // The toggle keeps the menu open (the other toggle stands
                // right here; the menu closes on escape / outside).
                event.preventDefault();
                doc.updateBlock(id, { lineNumbers: !lineNumbers });
              }}
            >
              <Hash className="size-4" />
              Line numbers
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={wrap}
              data-code-option="wrap"
              onSelect={(event) => {
                event.preventDefault();
                doc.updateBlock(id, { wrap: !wrap });
              }}
            >
              <TextWrap className="size-4" />
              Wrap long lines
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export { CodeHeader };
export type { CodeHeaderProps };
