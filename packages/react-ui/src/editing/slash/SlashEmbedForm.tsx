/**
 * The slash `Embed` form (the embed-creation affordance): a URL input
 * (auto-focused) only — the kind stands the `iframe` default (the renderer's
 * hint; all kinds render as an iframe). The menu stands open over the phrase
 * while the form stands; the commit (the URL's Enter, or the check) lands the
 * phrase strip + the `insertBlock('embed', { kind: "iframe", src })` in the
 * caller's transact. An empty (or whitespace-only) URL commits nothing (the
 * menu stands open on the phrase — the Image / Database contract).
 */
import { useTranslation } from "react-i18next";

import { useEffect, useRef, useState } from "react";

import { isSafeEmbedSrc } from "docblocks-core";

import { DocblocksI18nProvider } from "../../i18n";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { Check } from "../../shared/ui/icons";
import { preventDefault } from "../../shared/utils";

/** The embed's kind (the renderer's hint — the form stands the URL only). */
const EMBED_KIND_IFRAME = "iframe";

/** The embed form's props (the commit / the cancel — the phrase strip + the
 *  insert commit is the caller's transact). */
interface SlashEmbedFormProps {
  onCommit: (src: string) => void;
  onCancel: () => void;
}

/** The form's i18n scope: the package's instance stands the provider's seat
 *  over the form (the form stands also outside the editor's scope). */
function SlashEmbedForm(props: SlashEmbedFormProps) {
  return (
    <DocblocksI18nProvider>
      <SlashEmbedFormInner {...props} />
    </DocblocksI18nProvider>
  );
}

/** The embed form panel (the slash menu's embed state). */
function SlashEmbedFormInner({ onCommit, onCancel }: SlashEmbedFormProps) {
  const { t } = useTranslation("slash");
  const [url, setUrl] = useState("");
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  // The URL input stands focused when the form stands (the keyboard's insert
  // flow: the item's click lands the focus, the URL types, the Enter / check
  // commits).
  useEffect(() => {
    urlInputRef.current?.focus();
  }, []);

  const commit = () => {
    const trimmed = url.trim();
    if (trimmed.length === 0) return;
    // The unsafe scheme stands no commit (the core's write posture rejects
    // it too — the `javascript:` / the foreign `data:`).
    if (!isSafeEmbedSrc(EMBED_KIND_IFRAME, trimmed)) return;
    onCommit(trimmed);
  };

  // The form's own keys are not the slash query's: stop the propagation (the
  // block's key handler would move the highlight and re-derive the query).
  // Escape cancels the form (the command list stands on the phrase).
  const stopFormKey = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") onCancel();
  };

  const canCommit = url.trim().length > 0 && isSafeEmbedSrc(EMBED_KIND_IFRAME, url.trim());
  // The unsafe-scheme hint (the commit stands rejected over the same rule —
  // the input feedback instead of the silent no-op).
  const unsafeHint =
    url.trim().length > 0 && !isSafeEmbedSrc(EMBED_KIND_IFRAME, url.trim()) ? t("embed.unsafeHint") : null;

  const onUrlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    stopFormKey(event);
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };
  const onUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => setUrl(event.target.value);

  return (
    <div data-slot="docblocks/slash-embed-form" className="flex w-56 flex-col gap-2 p-1">
      <Input
        size="sm"
        ref={urlInputRef}
        type="text"
        data-slot="docblocks/slash-embed-url"
        className="rounded-sm"
        placeholder={t("embed.urlPlaceholder")}
        value={url}
        onKeyDown={onUrlKeyDown}
        onChange={onUrlChange}
      />
      <Button
        data-slot="docblocks/slash-embed-insert"
        variant="outline"
        size="icon"
        className="size-7 cursor-default self-end rounded-sm bg-transparent disabled:cursor-default dark:bg-transparent"
        disabled={!canCommit}
        onMouseDown={preventDefault}
        onClick={commit}
      >
        <Check className="size-4" />
      </Button>
      {unsafeHint !== null && (
        <p data-slot="docblocks/slash-embed-hint" className="px-1 text-xs text-destructive">
          {unsafeHint}
        </p>
      )}
    </div>
  );
}

export { SlashEmbedForm };
