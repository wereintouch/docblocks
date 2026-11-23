import type { DatabaseBridge } from "docblocks-react-ui";

import type { MasterDoc, PaneDoc } from "./pane-doc";

declare global {
  interface Window {
    /** The playground pane's insert hook (harness attrs; see apps/playground/src/insert-blocks.ts). */
    __insertBlock?: (client: "a" | "b", type: string) => string | null;
    /** The playground panes' live docs (per letter; null until the pane is mounted) — the command API the e2e suite reads/drives. */
    __paneDocs?: { a: PaneDoc | null; b: PaneDoc | null };
    /** The playground panes' master docs (the sync-embed targets, per letter; null until the pane is mounted) — the master's command API the e2e suite reads/drives. */
    __masterDocs?: { a: MasterDoc | null; b: MasterDoc | null };
    /** The catalog pane's live doc (catalog mode only; null outside it) — the harness global the visual spec reads for the byte-stable snapshot. */
    __catalogDoc?: PaneDoc | null;
    /** The playground pane's default database bridge (harness global; the state is per page) — the e2e bridge suite reads/drives it. */
    __bridge?: DatabaseBridge;
    /** The page's paste payload's stash (the no-grant engine's stand: the firefox/webkit's clipboard's read takes no permission — the seed's write stands here, the paste's dispatch reads it). */
    __pbSeed?: { html?: string; plain?: string };
    /** The app's clipboard write's capture queue (the no-read engine's copy's assertion stand: the `copy`'s event + the clipboard API's write(s) intercepted). */
    __pbWrites?: { html?: string; plain?: string }[];
    /** The playground blob store's `get` calls in order (the lazy loading's probe: which file ids resolved). */
    __blobGets?: string[];
    /** The playground pane's published stand's re-read (the publish.ts's harness stand: the room's shared localStorage stand over the pane's published's prop; true when a stand was applied) — the e2e's A/B publish flow drives it. */
    __reloadPublished?: (client: "a" | "b") => boolean;
  }
}
