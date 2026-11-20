/** The per-instance editor context: the store, the doc, the selection
 *  handle, and the effective customization values. */
import type { BlockId, Doc } from "docblocks-core";

import type { BlobStore } from "../../blob-store";
import type { BlockRendererMap } from "../../blocks";
import type { DatabaseBridge } from "../../database";
import type { EditorStore } from "../../state";
import type { AttributeTypePicker, RenderAttribute } from "./attributes";
import type { MentionInteractions, MentionProvider } from "./mentions";
import type { AccessLevel, EditorMode } from "./modes";
import type { CoverPresetSets, DocDescription, DocTags } from "./panels";
import type { PdfPreview } from "./pdf";
import type { PresenceConfig } from "./presence";
import type { SelectionRef } from "./selection";
import type { EmbedSandboxPolicy, SyncEmbedResolver } from "./sync-embed";

/** Per-instance editor context: the store, the doc, the selection handle, and the customization values. */
interface EditorContextValue {
  store: EditorStore;
  doc: Doc;
  selection: SelectionRef;
  /** Consumer renderers by block type; empty when none were supplied. */
  renderers: BlockRendererMap;
  /** The effective blob bridge (the consumer's store, the legacy resolver
   *  wrapped, or the shared default in-memory store) — always present. */
  blobStore: BlobStore;
  /** The effective database bridge (the consumer's implementation);
   *  undefined when none was supplied — the external-form database blocks
   *  render the disconnected placeholder. */
  databaseBridge: DatabaseBridge | undefined;
  /** The sync-embed master-doc resolver; null when none was supplied. */
  syncEmbedResolver: SyncEmbedResolver | null;
  /** The consumer's PDF first-page preview renderer; null when none was supplied (the native iframe stands). */
  pdfPreview: PdfPreview | null;
  /** The consumer's mention search provider; null when none was supplied (`@` stays plain text). */
  mentionProvider: MentionProvider | null;
  /** The consumer's mention interactions (the hover card + the click); null when none was supplied (the chip stands inert). */
  mentionInteractions: MentionInteractions | null;
  /** The attribute keys hidden from the document-attributes panel (the preset and the system keys); an empty list stands the full panel. */
  hiddenAttributes: readonly string[];
  /** The consumer's per-key attribute-value renderer (the `renderAttribute` prop); null stands the built-in editors. */
  renderAttribute: RenderAttribute | null;
  /** The consumer's attribute type picker (the `attributeTypePicker` prop); null stands the built-in picker. */
  attributeTypePicker: AttributeTypePicker | null;
  /** The consumer's tags contract (the `docTags` prop); null stands the display-only stand (the `notSet` over the row). */
  docTags: DocTags | null;
  /** The consumer's description contract (the `docDescription` prop); null stands the built-in stand (the value over the doc's record). */
  docDescription: DocDescription | null;
  /** The consumer's cover preset gallery (the `coverPresets` prop); null stands the built-in's stand (the preset's grid stands absent). */
  coverPresets: CoverPresetSets | null;
  /** The effective embed sandbox policy (the consumer's, or the safe default) — always present. */
  embedSandbox: EmbedSandboxPolicy;
  /** The entry-list root: the document root by default, a subtree block otherwise. */
  rootBlockId: BlockId;
  /** The enclosing providers' doc ids, outermost first (the sync-embed cycle visited-set). */
  ancestorDocIds: readonly string[];
  /** The number of enclosing editor renders (the sync-embed cycle depth bound). */
  embedDepth: number;
  /** The consumer's empty-block hint override; null selects the localized default. */
  commandPalettePlaceholder: string | null;
  /** The consumer's access level (the effective stand: the own prop, else the enclosing one, else "editor"). */
  accessLevel: AccessLevel;
  /** The effective document mode (resolved: a viewer stands "published" over any stand; a nested provider without its own `mode` inherits the enclosing one). */
  mode: EditorMode;
  /** True over the non-edit modes ("view" / "published"): every editing surface gates off (the read-only stand). */
  viewMode: boolean;
  /** The presence identity + cipher (the provider's `presence` prop); null when none was supplied (the legacy's anonymous stand). */
  presence: PresenceConfig | null;
}

export type { EditorContextValue };
