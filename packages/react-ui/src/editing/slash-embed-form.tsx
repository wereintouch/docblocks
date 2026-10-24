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

import { Check } from "../shared/ui/icons";
import type { EmbedKind } from "./slash/models";

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

  return (
    <div data-slot="docblocks/slash-embed-form" className="flex w-56 flex-col gap-2 p-1">
      <input
        ref={urlInputRef}
        type="text"
        data-slot="docblocks/slash-embed-url"
        className="
          h-8 w-full rounded-sm border border-border bg-transparent px-2 text-sm outline-none
          placeholder:text-muted-foreground
        "
        placeholder="Embed URL (https://…)"
        value={url}
        onKeyDown={(event) => {
          stopFormKey(event);
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        onChange={(event) => setUrl(event.target.value)}
      />
      <div className="flex items-center gap-1">
        <select
          data-slot="docblocks/slash-embed-kind"
          className="
            h-7 min-w-0 flex-1 cursor-default rounded-sm border border-border bg-transparent px-1 text-sm
            text-foreground outline-none
          "
          value={kind}
          onKeyDown={stopFormKey}
          onChange={(event) => setKind(event.target.value as EmbedKind)}
        >
          {EMBED_KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-slot="docblocks/slash-embed-insert"
          className="
            flex size-7 shrink-0 cursor-default items-center justify-center rounded-sm border border-border
            text-foreground select-none
            hover:bg-accent hover:text-accent-foreground
            disabled:cursor-default disabled:opacity-50
          "
          disabled={!canCommit}
          onMouseDown={(event) => event.preventDefault()}
          onClick={commit}
        >
          <Check className="size-4" />
        </button>
      </div>
    </div>
  );
}

export { SlashEmbedForm };
