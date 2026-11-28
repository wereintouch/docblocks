import {
  type BlockRendererMap,
  Editor,
  type EditorMode,
  EditorProvider,
  type EditorView,
  type PresenceConfig,
  type SyncEmbedResolver,
  useCoverAverageColor,
} from "docblocks-react-ui";
import { MermaidCodeRenderer } from "docblocks-react-ui/mermaid";
import { PdfFirstPage } from "docblocks-react-ui/pdf";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import type { Doc } from "docblocks-core";

import { attributeTypePickerDemo, renderAttributeDemo, useDocDescriptionDemo, useDocTagsDemo } from "./attribute-demos";
import { blobStore, coverPresets } from "./blob-fixtures";
import { databaseBridge } from "./database-seed";
import { databaseTableSection } from "./database-table-section";
import { PresenceShareControl } from "./inspect/PresenceShareControl";
import { mentionInteractions } from "./mention-card";
import { mentionProvider } from "./mention-provider";
import { stubPresenceCrypto } from "./stub-crypto";
import type { Runtime } from "./use-sync-runtime";

/**
 * The pane's renderer map (the demo of the `./mermaid` subpath): a
 * `code` block with `language: "mermaid"` renders the code/preview modes
 * (the default code mode) — every other code block falls through to the
 * built-in rendering inside the renderer. Module-level: the provider
 * reads the map per render, so the reference must be stable.
 */
const BLOCK_RENDERERS: BlockRendererMap = { code: MermaidCodeRenderer };

/**
 * The panes' presence identity (the sharing's stand: the module-level
 * stable reference — the provider reads the prop per render, and a fresh
 * inline object would churn the context value). The user id is the pane's
 * letter suffixed (the e2e's target/stranger grants stand the ids), the
 * cipher is the harness's stub (the presence-sharing demo — the e2e checks
 * the privacy property, not the cryptography).
 */
const PRESENCE: Record<"a" | "b", PresenceConfig> = {
  a: { userId: "user-a", name: "User A", crypto: stubPresenceCrypto("user-a") },
  b: { userId: "user-b", name: "User B", crypto: stubPresenceCrypto("user-b") },
};

/**
 * The consumer-side cover's glow's reporter (the glow's demo's stand —
 * the surroundings' visual stands the consumer's chrome over the
 * package's `useCoverAverageColor`'s data; the package's DOM ends at the
 * card). The average's color stands on the host's element as the
 * `--cover-glow`'s variable (the harness's CSS's mix's input).
 */
function CoverGlowReporter({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  const color = useCoverAverageColor();
  useEffect(() => {
    const el = hostRef.current;
    if (el === null) return;
    if (color === null) el.style.removeProperty("--cover-glow");
    else el.style.setProperty("--cover-glow", color);
  }, [color, hostRef]);
  return null;
}

/** The consumer's attribute demos' props (the tags / description's per-pane
 *  store stands + the `attrDemo`'s customization renderers + the cover
 *  preset's gallery). */
function useConsumerDemos(attrDemo: boolean, coverPresetsOn: boolean) {
  // The consumer's tags demo (the per-pane's store's stand — the document
  // never stores the tags; the contract's value is the memoized stand
  // over the list's changes only).
  const docTags = useDocTagsDemo(attrDemo);
  // The consumer's description demo (the per-pane's store's stand — the
  // document never stores the description; the contract's value is the
  // memoized stand over the value's changes only).
  const docDescription = useDocDescriptionDemo(attrDemo);
  return {
    docTags,
    docDescription,
    renderAttribute: attrDemo ? renderAttributeDemo : undefined,
    attributeTypePicker: attrDemo ? attributeTypePickerDemo : undefined,
    coverPresets: coverPresetsOn ? coverPresets : undefined,
  };
}

/**
 * The pane's doc area: the real editor (the EditorProvider + the base
 * `Editor` on the pane's runtime — the viewer's pane stands the published
 * snapshot stand read-only) with the harness' consumer stands (the blob
 * store, the database bridge, the mermaid renderer, the mention provider
 * + interactions, the attribute demos, the cover presets, the presence
 * identity, the sharing's control).
 */
function DocArea({
  client,
  role,
  view,
  mode,
  publishedDoc,
  publishedSeq,
  publishedCopyable,
  runtime,
  syncEmbedResolver,
  catalog,
  blobEager,
  innerScroll,
  coverPresetsOn,
  attrDemo,
  peerLetter,
  docAreaRef,
}: {
  client: "a" | "b";
  role: "editor" | "viewer";
  view: EditorView;
  /** The consumer's document mode (the editor's controlled stand; the viewer's access level forces published). */
  mode: EditorMode;
  publishedDoc: Doc | null;
  publishedSeq: number;
  /** The published stand's selection policy (the provider's `publishedCopyable`). */
  publishedCopyable: boolean;
  runtime: Runtime | null;
  syncEmbedResolver: SyncEmbedResolver | undefined;
  catalog: boolean;
  blobEager: boolean;
  /** The pane's own box scrolls the document (the consumer's scroll
   *  container — the provider's `scrollContainer`). */
  innerScroll: boolean;
  coverPresetsOn: boolean;
  attrDemo: boolean;
  peerLetter: "a" | "b";
  docAreaRef: RefObject<HTMLDivElement | null>;
}) {
  const demos = useConsumerDemos(attrDemo, coverPresetsOn);
  /** The provider's blob loading policy: the catalog pane stands eager (the
   *  visual goldens capture the whole page — the lazy band would leave the
   *  off-screen images as placeholders); `?blobEager=1` flips the dev
   *  harness's stand; the package's default is lazy. */
  const blobLoading: "eager" | "lazy" = catalog || blobEager ? "eager" : "lazy";

  /** The inner-scroll stand's element: the pane's box lands at mount, so
   *  the provider receives the scroll container over state (the prop is
   *  read per render, not captured once). */
  const [scrollContainer, setScrollContainer] = useState<Element | null>(null);
  const areaRef = useCallback(
    (node: HTMLDivElement | null) => {
      docAreaRef.current = node;
      setScrollContainer(innerScroll ? node : null);
    },
    [docAreaRef, innerScroll]
  );

  // The page flow's doc area: a fixed width over the wide window —
  // the box hugs the page column (the 1060 px's column — the 900 px
  // block zone + the two 80 px gutter paddings — + the editor
  // card's 2x1 border + the box's 2x1 border + 2x8 padding = 1080
  // border-box): the blocks stand exactly the token's width over
  // the box. The narrow window stands the full width (the limit
  // never over-constrains). The CATALOG mode keeps the visual-golden
  // editor width (702: the doc area's content width the goldens
  // were captured at) — the width is 720 because the shipped
  // utility CSS puts box-sizing: border-box on every element (the
  // preflight in the shipped styles.css's base layer): 702 content
  // + 2x1 border + 2x8 padding.
  const pageStyle: CSSProperties =
    view === "canvas"
      ? {
          // A definite height (not flex-derived: main is content-height, so a
          // flex:1 basis would collapse the canvas chain) for the editor's
          // flex chain — the canvas view is a viewport-like surface.
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 72px)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--background)",
        }
      : catalog
        ? { width: 720, maxWidth: "100%", border: "1px solid var(--border)", padding: 8, minHeight: 40 }
        : {
            width: 1080,
            maxWidth: "100%",
            alignSelf: "center",
            border: "1px solid var(--border)",
            padding: 8,
            minHeight: 40,
          };

  // The pane's own scroll box (`?innerScroll=1`): the document scrolls inside
  // the box instead of the page — the lazy resolution's band frames on it.
  const docAreaStyle: CSSProperties =
    innerScroll && view !== "canvas" ? { ...pageStyle, height: "calc(100vh - 72px)", overflowY: "auto" } : pageStyle;

  return (
    <div data-testid={`doc-${client}`} ref={areaRef} style={docAreaStyle} className="cover-glow-host">
      {role === "viewer" ? (
        // The viewer's security stand: the published snapshot is the
        // doc (the live document never reaches the reader's browser);
        // an absent snapshot renders the provider's not-published
        // placeholder. Each load yields a fresh doc instance, so the
        // key forces a provider remount on swap (the doc instance
        // must not change over a mounted provider).
        <EditorProvider
          key={publishedSeq}
          doc={publishedDoc ?? undefined}
          blobStore={blobStore}
          blobLoading={blobLoading}
          scrollContainer={scrollContainer}
          databaseBridge={databaseBridge}
          databaseTableSection={databaseTableSection}
          blockRenderers={BLOCK_RENDERERS}
          pdfPreview={PdfFirstPage}
          mentionProvider={mentionProvider}
          mentionInteractions={mentionInteractions}
          {...demos}
          accessLevel="viewer"
          publishedCopyable={publishedCopyable}
        >
          <Editor view={view} />
          <CoverGlowReporter hostRef={docAreaRef} />
        </EditorProvider>
      ) : (
        runtime !== null && (
          <EditorProvider
            doc={runtime.doc}
            provider={runtime.provider}
            blobStore={blobStore}
            blobLoading={blobLoading}
            scrollContainer={scrollContainer}
            databaseBridge={databaseBridge}
            databaseTableSection={databaseTableSection}
            blockRenderers={BLOCK_RENDERERS}
            syncEmbedResolver={syncEmbedResolver}
            pdfPreview={PdfFirstPage}
            mentionProvider={mentionProvider}
            mentionInteractions={mentionInteractions}
            {...demos}
            presence={PRESENCE[client]}
            accessLevel={role}
            mode={mode}
            publishedDoc={publishedDoc}
            publishedCopyable={publishedCopyable}
          >
            <Editor view={view} />
            <CoverGlowReporter hostRef={docAreaRef} />
            {/* The harness's sharing's control (the consumer-side UI over the hook — the
                 provider's context; the catalog's golden's fixture stands no control). */}
            {!catalog && <PresenceShareControl client={client} peerUserId={`user-${peerLetter}`} />}
          </EditorProvider>
        )
      )}
    </div>
  );
}

export { DocArea };
