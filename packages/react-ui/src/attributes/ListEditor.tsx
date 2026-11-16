/** The list editor (the default stand): the vertical's stack of the item's
 *  lines — every line's own input + the line's removal (the × over the
 *  line's right) + the new line's input over the stack's tail (the Enter's
 *  add, the empty's Backspace's last line's removal — the tags' input's
 *  parity). The lines' local stand over the external's resync (the store's
 *  re-read); every discrete change commits the whole list (one
 *  `setAttribute` — the typing's no-commit until the blur / the Enter). The
 *  inputs stand the project's `Input` over the row's flat field stand. */
import { useTranslation } from "react-i18next";

import { useRef, useState } from "react";

import { Input } from "../shared/ui/Input";
import { X } from "../shared/ui/icons";

function ListEditor({
  items,
  name,
  readOnly,
  slot,
  onItemsChange,
}: {
  items: readonly string[];
  /** The attribute's key (the aria's name's stand). */
  name: string;
  readOnly: boolean;
  /** The group's data-slot. */
  slot: string;
  onItemsChange: (items: string[]) => void;
}) {
  const { t } = useTranslation("editor");
  const signature = items.join("\u0000");
  const [lines, setLines] = useState<string[]>(() => [...items]);
  const [lastSync, setLastSync] = useState(signature);
  // The external's change (a remote's edit, the consumer's write) resyncs
  // the lines' stand (the reference's equality over the signature).
  if (signature !== lastSync) {
    setLines([...items]);
    setLastSync(signature);
  }
  const [draft, setDraft] = useState("");
  const addInputRef = useRef<HTMLInputElement | null>(null);

  const commit = (next: string[]): void => {
    if (next.length === items.length && next.every((item, index) => item === items[index])) return;
    onItemsChange(next);
  };
  const changeLine = (index: number, value: string): void => {
    const next = [...lines];
    next[index] = value;
    setLines(next);
  };
  const removeLine = (index: number): void => {
    const next = lines.filter((_, i) => i !== index);
    setLines(next);
    commit(next);
  };
  const addLine = (): void => {
    const item = draft.trim();
    if (item === "") return;
    const next = [...lines, item];
    setLines(next);
    setDraft("");
    commit(next);
  };

  if (readOnly) {
    return (
      <div data-slot={slot} className="flex min-w-0 flex-col items-start">
        {items.length === 0 ? (
          <span className="px-1.5 py-1 text-sm text-muted-foreground">{t("attributes.notSet")}</span>
        ) : (
          items.map((item, index) => (
            <span key={index} data-slot={`${slot}-item`} className="truncate px-1.5 text-sm">
              {item}
            </span>
          ))
        )}
      </div>
    );
  }

  return (
    <div data-slot={slot} className="flex min-w-0 flex-1 flex-col gap-0.5">
      {lines.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <Input
            data-slot={`${slot}-line`}
            aria-label={t("attributes.listLineAria", { name, index: String(index + 1) })}
            variant="inline"
            className="min-w-0 flex-1"
            value={item}
            onChange={(event) => changeLine(index, event.target.value)}
            onBlur={() => commit(lines)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(lines);
                // The line's commit stands the new line's input's focus (the
                // add's path's parity over the tags' input).
                addInputRef.current?.focus();
              }
            }}
          />
          <button
            type="button"
            data-slot={`${slot}-line-remove`}
            aria-label={t("attributes.listLineRemoveAria", { index: String(index + 1) })}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={() => removeLine(index)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <Input
          ref={addInputRef}
          data-slot={`${slot}-input`}
          aria-label={t("attributes.listAddAria", { name })}
          variant="inline"
          className="min-w-0 flex-1 placeholder:text-muted-foreground/70"
          placeholder={t("attributes.listAddPlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addLine();
            } else if (event.key === "Backspace" && draft === "" && lines.length > 0) {
              removeLine(lines.length - 1);
            }
          }}
          onBlur={() => {
            if (draft.trim() !== "") addLine();
          }}
        />
      </div>
    </div>
  );
}

export { ListEditor };
