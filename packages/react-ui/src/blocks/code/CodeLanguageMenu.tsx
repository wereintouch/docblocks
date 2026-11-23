/**
 * The code block's header's language's control (the left group): the name's
 * display (always shown — the default "Plain Text" over the absent / the
 * empty `language` attr) + the picker (the non-modal popover with a search
 * field — the typed name's filter over the curated base set, the Enter's
 * first match's pick). A pick is an `updateBlock({ language })` (one undo
 * step, one wire update). The list is a curated base set (a consumer can
 * override the renderer for a different set). The read-only's stand (the
 * view / published's modes): the language stands display-only (the picker's
 * entry stands off — the attr's write's stand is no).
 */
import { useTranslation } from "react-i18next";

import { useState } from "react";

import type { BlockId, CodeBlock } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { Check, ChevronDown, Search } from "../../shared/ui/icons";

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

interface CodeLanguageMenuProps {
  id: BlockId;
  block: CodeBlock;
  /** The picker's open's state (the header's open menus' stand keeps the controls' reveal). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CodeLanguageMenu({ id, block, open, onOpenChange }: CodeLanguageMenuProps) {
  const { t } = useTranslation("blocks");
  const { doc, viewMode } = useEditorContext();
  const [query, setQuery] = useState("");

  const language = block.attrs?.language;
  const trimmed = query.trim().toLowerCase();
  const matches = trimmed === "" ? LANGUAGES : LANGUAGES.filter((lang) => lang.label.toLowerCase().includes(trimmed));

  /** Pick a language (a no-op when the block already carries it). */
  const pickLanguage = (value: string): void => {
    onOpenChange(false);
    setQuery("");
    if ((language ?? "") === value) return;
    doc.updateBlock(id, { language: value });
  };

  const onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value);
  const onQueryKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = matches[0];
    if (first !== undefined) pickLanguage(first.value);
  };
  const pick = (value: string) => () => pickLanguage(value);

  return viewMode ? (
    // The read-only stand (the view / published's modes): the
    // language stands display-only (the picker's entry stands off —
    // the attr's write's stand is no).
    <span
      data-slot="docblocks/code-language"
      aria-label={t("code.language")}
      className="flex h-7 max-w-45 items-center gap-1 px-2 text-[length:inherit]"
    >
      <span className="truncate">{languageLabel(language)}</span>
    </span>
  ) : (
    <Popover modal={false} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-slot="docblocks/code-language"
          aria-label={t("code.chooseLanguage")}
          className="h-7 max-w-45 gap-1 px-2 text-[length:inherit]"
        >
          <span className="truncate">{languageLabel(language)}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        data-slot="docblocks/code-language-menu"
        aria-label={t("code.language")}
        className="flex w-56 flex-col gap-2"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            size="sm"
            data-slot="docblocks/code-language-search"
            type="text"
            value={query}
            onChange={onQueryChange}
            onKeyDown={onQueryKeyDown}
            placeholder={t("code.searchPlaceholder")}
            aria-label={t("code.searchAria")}
            className="pr-2 pl-7 focus:border-ring"
          />
        </div>
        <ScrollArea role="listbox" aria-label={t("code.languages")} className="max-h-64 overflow-x-hidden py-0.5">
          {matches.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("common:noMatches")}</div>
          ) : (
            matches.map((lang) => {
              const selected = (language ?? "") === lang.value;
              return (
                <div
                  key={lang.value || "plain"}
                  role="option"
                  aria-selected={selected}
                  data-lang-value={lang.value || "plain"}
                  onClick={pick(lang.value)}
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
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export { CodeLanguageMenu };
