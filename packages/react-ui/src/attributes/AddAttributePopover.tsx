/** The custom-attribute add's entry over the list's tail (the button stands
 *  over the last row): the popover's type pick + the name's draft + the
 *  commit (the row's creation — the list's replenish). The open's state,
 *  the type's pick (the consumer's `attributeTypePicker` replaces the
 *  picker, not the state), the name's draft, and the error stand the
 *  entry's own (the session's stand — the panel's re-render stands no
 *  touch). */
import { useTranslation } from "react-i18next";

import { useState } from "react";

import { ATTRIBUTE_TYPES } from "docblocks-core";
import type { AttributeType } from "docblocks-core";

import type { AttributeTypePicker } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Input } from "../shared/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { SegmentSelector } from "../shared/ui/SegmentSelector";
import { Plus } from "../shared/ui/icons";

function AddAttributePopover({
  onAdd,
  typePicker,
}: {
  /** The commit's write: the name stands the key, the typed value stands
   *  the type's initial form. The returned string stands the error (the
   *  reserved key's stand — the input's open stand over the error), null
   *  over the commit. */
  onAdd: (key: string, type: AttributeType) => string | null;
  /** The consumer's type picker's replacement (the absent / the null's
   *  stand the built-in's type picker). */
  typePicker: AttributeTypePicker | null;
}) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<AttributeType>("string");
  const Picker = typePicker;

  const commit = (): void => {
    const key = name.trim();
    if (key === "") return;
    const next = onAdd(key, type);
    if (next === null) {
      setName("");
      setError(null);
      setOpen(false);
    } else {
      setError(next);
    }
  };

  return (
    // The add's entry over the list's tail (the button stands over the
    // last row): the popover's type pick + the name's draft + the commit
    // (the row's creation — the list's replenish; the button stands over
    // the list's tail over the commit).
    <div data-slot="docblocks/attributes-add" className="mt-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setName("");
            setError(null);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-slot="docblocks/attributes-add-button"
            aria-label={t("attributes.addAttribute")}
            aria-haspopup="dialog"
            className="
              flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground
              hover:bg-muted/50 hover:text-foreground
            "
          >
            <Plus className="size-3.5" />
            {t("attributes.addAttribute")}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-fit min-w-72">
          {/* The type's picker (the consumer's `attributeTypePicker`'s
              stand; the built-in's sliding-pill's stand otherwise —
              the document view's selector's parity). */}
          {Picker !== null ? (
            <Picker value={type} onChange={setType} />
          ) : (
            <SegmentSelector<AttributeType>
              options={ATTRIBUTE_TYPES.map((item) => ({
                value: item,
                label: t(`attributes.type${item[0]!.toUpperCase()}${item.slice(1)}`),
              }))}
              value={type}
              onChange={setType}
              ariaLabel={t("attributes.typeAria")}
              slot="docblocks/attributes-add-type"
              pillSlot="docblocks/attributes-add-type-pill"
              buttonAttrName="type"
              size="text"
            />
          )}
          <div className="flex items-center gap-2">
            <Input
              data-slot="docblocks/attributes-add-key"
              aria-label={t("attributes.namePlaceholder")}
              className="h-8 min-w-0 flex-1 text-sm"
              placeholder={t("attributes.namePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-slot="docblocks/attributes-add-confirm"
              disabled={name.trim() === ""}
              onClick={commit}
            >
              {t("attributes.addConfirm")}
            </Button>
          </div>
          {error !== null ? (
            <span data-slot="docblocks/attributes-add-error" className="text-xs text-destructive">
              {error}
            </span>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export { AddAttributePopover };
