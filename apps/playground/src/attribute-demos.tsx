// The playground's attributes customization demo: the consumer's
// `renderAttribute` (the status's badge stand + the createdBy's consumer
// resolution over the mention catalog) and the `attributeTypePicker`
// (the consumer's own type picker over the built-in select).
import type { AttributeTypePickerProps, RenderAttributeProps } from "docblocks-react-ui";

import type { AttributeType } from "docblocks-core";

import { resolveMentionLabel } from "./mention-provider";

/** The consumer's status zone: the badge's display + the compact
 *  switcher over the edit mode (the value's zone only — the panel keeps
 *  the label's column). The `null`'s stand over every other key (the
 *  built-in's editors stand over the consumer's absence). */
function renderAttributeDemo({ key, value, onChange, onRemove, readOnly }: RenderAttributeProps): React.ReactNode {
  if (key === "status") {
    const current = typeof value === "string" ? value : null;
    const options =
      current === null ? ["draft", "published"] : [current, ...["draft", "published"].filter((o) => o !== current)];
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} data-testid="pg-attr-status-badge">
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: current === "published" ? "rgba(34, 197, 94, 0.15)" : "rgba(245, 158, 11, 0.15)",
            color: current === "published" ? "#16a34a" : "#b45309",
          }}
        >
          {current ?? "—"}
        </span>
        {readOnly ? null : (
          <>
            <select
              aria-label="status (consumer demo)"
              data-testid="pg-attr-status-select"
              style={{ fontSize: 12 }}
              value={current ?? ""}
              onChange={(event) => {
                if (event.target.value === "") onRemove();
                else onChange(event.target.value);
              }}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value="">(none)</option>
            </select>
            {current !== null ? (
              <button type="button" onClick={() => onRemove()} style={{ fontSize: 12 }} aria-label="remove status">
                ✕
              </button>
            ) : null}
          </>
        )}
      </span>
    );
  }
  if (key === "createdBy") {
    // The consumer's resolution's stand: the id-only reference stands its
    // display over the catalog (the label's snapshot stands absent).
    const ref =
      value !== null && typeof value === "object" && !Array.isArray(value) ? (value as { id?: unknown }).id : undefined;
    const id = typeof ref === "string" ? ref : null;
    return (
      <span
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
        data-testid="pg-attr-creator"
      >
        <span aria-hidden style={{ fontSize: 14 }}>
          👤
        </span>
        <span>{id !== null ? (resolveMentionLabel("user", id) ?? id) : "—"}</span>
        {id !== null ? <span style={{ fontSize: 11, opacity: 0.6 }}>({id})</span> : null}
      </span>
    );
  }
  return null;
}

/** The consumer's type picker (the built-in select's stand replaced):
 *  the compact segmented's buttons over the `ATTRIBUTE_TYPES`'s enum. */
function attributeTypePickerDemo({ value, onChange }: AttributeTypePickerProps): React.ReactNode {
  const options: Array<{ value: AttributeType; label: string; title: string }> = [
    { value: "string", label: "S", title: "string" },
    { value: "number", label: "N", title: "number" },
    { value: "boolean", label: "B", title: "boolean" },
    { value: "list", label: "L", title: "list" },
    { value: "mention", label: "@", title: "mention" },
  ];
  return (
    <span
      style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}
      data-testid="pg-attr-type-picker"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-label={option.title}
          onClick={() => onChange(option.value)}
          style={{
            fontSize: 11,
            padding: "3px 7px",
            background: value === option.value ? "var(--accent)" : "transparent",
            color: value === option.value ? "var(--accent-foreground)" : "var(--muted-foreground)",
            cursor: "pointer",
          }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

export { attributeTypePickerDemo, renderAttributeDemo };
