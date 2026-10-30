/**
 * The slash `Embed` form (the embed-creation affordance):
 * a URL input (auto-focused) + a kind selector (default `iframe` — all kinds
 * render as an iframe in v1; the kind is a renderer hint). The menu stands
 * open over the phrase while the form stands; the commit (the URL's Enter, or
 * the check) lands the phrase strip + the `insertBlock('embed', { kind, src })`
 * in the caller's transact. An empty (or whitespace-only) URL commits nothing
 * (the menu stands open on the phrase — the Image / Database contract).
 */
import { useEffect, useRef, useState } from "react";

import { BareSelect } from "../../shared/ui/BareSelect";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { Check } from "../../shared/ui/icons";
import { preventDefault } from "../../shared/utils";
import type { EmbedKind } from "./models";

/** The embed's kind catalog (the core `EmbedAttrs.kind` enum). */
const EMBED_KINDS = ["iframe", "github", "figma", "loom", "html"] as const;

/** The embed form panel (the slash menu's embed state). */
function SlashEmbedForm({
  onCommit,
  onCancel,
}: {
  onCommit: (input: { kind: EmbedKind; src: string }) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<EmbedKind>("iframe");
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
    onCommit({ kind, src: trimmed });
  };

  // The form's own keys are not the slash query's: stop the propagation (the
  // block's key handler would move the highlight and re-derive the query).
  // Escape cancels the form (the command list stands on the phrase).
  const stopFormKey = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") onCancel();
  };

  const canCommit = url.trim().length > 0;

  const onUrlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    stopFormKey(event);
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };
  const onUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => setUrl(event.target.value);
  const onKindChange = (event: React.ChangeEvent<HTMLSelectElement>) => setKind(event.target.value as EmbedKind);

  return (
    <div data-slot="docblocks/slash-embed-form" className="flex w-56 flex-col gap-2 p-1">
      <Input
        size="sm"
        ref={urlInputRef}
        type="text"
        data-slot="docblocks/slash-embed-url"
        className="rounded-sm"
        placeholder="Embed URL (https://…)"
        value={url}
        onKeyDown={onUrlKeyDown}
        onChange={onUrlChange}
      />
      <div className="flex items-center gap-1">
        <BareSelect
          data-slot="docblocks/slash-embed-kind"
          className="h-7 min-w-0 flex-1 cursor-default rounded-sm px-1"
          value={kind}
          onKeyDown={stopFormKey}
          onChange={onKindChange}
        >
          {EMBED_KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </BareSelect>
        <Button
          data-slot="docblocks/slash-embed-insert"
          variant="outline"
          size="icon"
          className="size-7 cursor-default rounded-sm bg-transparent disabled:cursor-default dark:bg-transparent"
          disabled={!canCommit}
          onMouseDown={preventDefault}
          onClick={commit}
        >
          <Check className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export { SlashEmbedForm };
