import { useEffect, useState } from "react";

import type { Doc, DocJSON } from "docblocks-core";

/**
 * The pane's live document snapshot: one `doc.onChange` subscription (the
 * pane owns the doc and keeps it alive), a pretty JSON render refreshed on
 * every transaction (local or remote), and the compact JSON byte count
 * next to the title.
 */
function JsonInspector({ client, doc }: { client: "a" | "b"; doc: Doc }) {
  const [snapshot, setSnapshot] = useState<DocJSON>(() => doc.toJSON());

  useEffect(() => {
    const refresh = () => setSnapshot(doc.toJSON());
    refresh();
    return doc.onChange(refresh);
  }, [doc]);

  return (
    <div data-testid={`json-${client}`} style={{ border: "1px solid #ccc", marginTop: 8 }}>
      <div style={{ padding: "4px 8px", borderBottom: "1px solid #ccc", fontSize: 12 }}>
        json — <span data-testid={`json-bytes-${client}`}>{JSON.stringify(snapshot).length} B</span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 8,
          overflow: "auto",
          maxHeight: 220,
          fontFamily: "monospace",
          fontSize: 11,
        }}
      >
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    </div>
  );
}

export { JsonInspector };
