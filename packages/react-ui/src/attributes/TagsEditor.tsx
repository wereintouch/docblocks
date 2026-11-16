/** The tags editor (the default stand): the chips + the add input. Every
 *  change commits the whole list (one `setAttribute`). The add input stands
 *  the project's `Input` over the row's flat field stand (the focus's
 *  border only). */
import { useTranslation } from "react-i18next";

import { useState } from "react";

import { Input } from "../shared/ui/Input";
import { X } from "../shared/ui/icons";

function TagsEditor({
  tags,
  readOnly,
  onTagsChange,
}: {
  tags: readonly string[];
  readOnly: boolean;
  onTagsChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation("editor");
  const [draft, setDraft] = useState("");

  const commit = (next: string[]): void => {
    if (next.length === tags.length && next.every((tag, index) => tag === tags[index])) return;
    onTagsChange(next);
  };

  const addTag = (raw: string): void => {
    const tag = raw.trim();
    if (tag === "" || tags.includes(tag)) return;
    commit([...tags, tag]);
  };

  return (
    <div data-slot="docblocks/attributes-tags" className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          data-slot="docblocks/attributes-tag"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
        >
          {tag}
          {readOnly ? null : (
            <button
              type="button"
              data-slot="docblocks/attributes-tag-remove"
              aria-label={tag}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => commit(tags.filter((x) => x !== tag))}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {readOnly ? null : (
        <Input
          data-slot="docblocks/attributes-tag-input"
          aria-label={t("attributes.addTagAria")}
          variant="inline"
          className="h-6 min-w-24 flex-1"
          placeholder={t("attributes.addTagPlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag(draft);
              setDraft("");
            } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
              commit(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim() !== "") {
              addTag(draft);
              setDraft("");
            }
          }}
        />
      )}
    </div>
  );
}

export { TagsEditor };
