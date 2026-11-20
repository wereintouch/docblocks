import { useEffect, useState } from "react";

import type { Doc, DocJSON } from "docblocks-core";

/** The inspector's render's cap (the compact JSON's bytes): over the cap
 * the full pretty render stands no DOM of its own (the heavy doc's
 * several-MB JSON over a single text node stood the renderer's crash) —
 * the notice's stand over the byte count + the head's preview. */
const JSON_INSPECTOR_CAP_BYTES = 512 * 1024;
const JSON_INSPECTOR_PREVIEW_CHARS = 32 * 1024;

/**
 * The pane's live document snapshot: one `doc.onChange` subscription (the
 * pane owns the doc and keeps it alive), a pretty JSON render refreshed on
 * every transaction (local or remote), and the compact JSON byte count
 * next to the title. Over the cap's stand (the heavy doc): the byte count
 * + the head's preview instead of the full text.
 */
function JsonInspector({ client, doc }: { client: "a" | "b"; doc: Doc }) {
  const [snapshot, setSnapshot] = useState<DocJSON>(() => doc.toJSON());

  useEffect(() => {
    const refresh = () => setSnapshot(doc.toJSON());
    refresh();
    return doc.onChange(refresh);
  }, [doc]);

  const compact = JSON.stringify(snapshot);
  const overCap = compact.length > JSON_INSPECTOR_CAP_BYTES;
  const body = overCap
    ? `${compact.slice(0, JSON_INSPECTOR_PREVIEW_CHARS)}\n… (truncated — the cap's stand)`
    : JSON.stringify(snapshot, null, 2);

  return (
    <div data-testid={`json-${client}`} style={{ border: "1px solid var(--border)", marginTop: 8 }}>
      <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
        json — {compact.length} B{overCap ? " (truncated over the inspector's cap)" : ""}
      </div>
      <pre className="json-view">{body}</pre>
    </div>
  );
}

export { JsonInspector };
