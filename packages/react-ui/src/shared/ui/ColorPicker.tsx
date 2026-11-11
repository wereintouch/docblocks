/**
 * The custom color's picker body (the callout menu's custom swatch opens it
 * as an inline section): the native `input type="color"` (the live scrub —
 * no doc write over the scrub) and the hex field (the strict `#rrggbb`).
 * The doc write stands one `onCommit` per pick (one undo step, one wire
 * update — the swatch pick's parity): the native dialog's commit (`change`),
 * the field's valid Enter / blur. An invalid field value resets to the
 * draft on blur (the picker stands the last valid stand). The close without
 * an explicit commit (the Esc / the toggle / the menu's dismiss) commits the
 * last scrubbed value (the picker's unmount commits it); an untouched
 * picker commits nothing.
 */
import { useTranslation } from "react-i18next";

import { useEffect, useRef, useState } from "react";

import { DocblocksI18nProvider } from "../../i18n";
import { Input } from "./Input";
import { normalizeHex } from "./color-utils";

interface ColorPickerProps {
  /** The current value (a hex); null when no color stands. */
  value: string | null;
  /** Report the committed hex (the parent's single doc write). */
  onCommit: (hex: string) => void;
  /** Report the picker's apply (the parent's menu's close). */
  onClose: () => void;
}

/** The absent value's stand: the native input's neutral default. */
const DEFAULT_HEX = "#808080";

/** The strict hex field's stand: `#` + six hex digits. */
const STRICT_HEX_RE = /^#([0-9a-f]{6})$/i;

function ColorPickerInner({ value, onCommit, onClose }: ColorPickerProps) {
  const { t } = useTranslation("common");
  // The live draft (the scrub's stand; the doc is written on the commit only).
  // The mount is the reseed: the section unmounts over every close.
  const [draft, setDraft] = useState(value ?? DEFAULT_HEX);
  // The field's raw text (validated on the commit gesture).
  const [field, setField] = useState(value ?? DEFAULT_HEX);

  const valueRef = useRef(value);
  valueRef.current = value;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The close-without-commit's stand (the Esc / the toggle / the menu's
  // dismiss): the last scrubbed value is the current one — the section's
  // unmount commits it (a write without the menu's close — the close is
  // underway). A scrub-less open (the untouched draft's default) commits
  // nothing; an explicit commit (the dialog's change / the field's gesture)
  // stands the unmount's write.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const touchedRef = useRef(false);
  const committedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!touchedRef.current || committedRef.current) return;
      const committed = normalizeHex(draftRef.current);
      const current = valueRef.current === null ? null : normalizeHex(valueRef.current);
      if (committed !== null && committed !== current) onCommitRef.current(committed);
    };
  }, []);

  // The native dialog's commit (`change` — the dialog's OK): the element's
  // own value stands the committed stand (the write + the menu's close).
  // The live `input` stand stands the draft only (no write over the scrub).
  const nativeRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = nativeRef.current;
    if (el === null) return;
    const onChange = (event: Event): void => {
      committedRef.current = true;
      const committed = normalizeHex((event.target as HTMLInputElement).value);
      const current = valueRef.current === null ? null : normalizeHex(valueRef.current);
      if (committed !== null && committed !== current) onCommitRef.current(committed);
      onCloseRef.current();
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  /** The field's commit gesture (the Enter / the valid blur): write + close. */
  const commitField = (raw: string): boolean => {
    const match = raw.trim().match(STRICT_HEX_RE);
    if (match === null) return false;
    committedRef.current = true;
    const hex = `#${match[1]!.toLowerCase()}`;
    setDraft(hex);
    setField(hex);
    const current = valueRef.current === null ? null : normalizeHex(valueRef.current);
    if (hex !== current) onCommitRef.current(hex);
    onCloseRef.current();
    return true;
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={nativeRef}
        type="color"
        value={draft}
        onInput={(event) => {
          touchedRef.current = true;
          setDraft(event.currentTarget.value);
        }}
        aria-label={t("colorPicker.aria")}
        className="h-8 w-8 cursor-pointer rounded-xs border border-(--border) bg-transparent p-0.5"
      />
      <Input
        value={field}
        size="sm"
        aria-label={t("colorPicker.hexAria")}
        placeholder="#rrggbb"
        className="font-(family-name:--docblocks-mono-font-family)"
        onChange={(event) => setField(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitField(field);
          }
        }}
        onBlur={() => {
          if (!commitField(field)) setField(draft);
        }}
      />
    </div>
  );
}

/** The palette's i18n scope: the package's instance stands the provider's
 *  seat over the picker (the primitive stands also outside the editor's
 *  scope — the ColorSwatches' parity). */
function ColorPicker(props: ColorPickerProps) {
  return (
    <DocblocksI18nProvider>
      <ColorPickerInner {...props} />
    </DocblocksI18nProvider>
  );
}

export { ColorPicker };
