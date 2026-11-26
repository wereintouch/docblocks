/** The provider's access props: the consumer's user level, the document
 *  mode, the published snapshot, and the presence identity. */
import type { Doc } from "docblocks-core";

import type { AccessLevel, EditorMode } from "./modes";
import type { PresenceConfig } from "./presence";

interface EditorProviderAccessProps {
  /**
   * Optional user access level: "viewer" locks the render to the
   * published's view (the `mode`'s stand is ignored — the current state is
   * never rendered for a reader); "editor" (the default) may edit and
   * view. Over the viewer's stand the `doc` is the published snapshot and
   * the `publishedDoc` prop is not consulted (the doc IS the snapshot).
   * Session state supplied by the consumer — never document data.
   */
  accessLevel?: AccessLevel;
  /**
   * Optional document mode (consumer-controlled, like the page/canvas
   * `view`): "edit" (the default) renders the live document editable,
   * "view" renders it read-only (the current state, the doc keeps
   * syncing), "published" renders the `publishedDoc`'s snapshot read-only.
   * A viewer stands "published" over every stand. A nested provider
   * without its own `mode` inherits the enclosing one.
   */
  mode?: EditorMode;
  /**
   * Optional published snapshot (a hydrated `Doc`, the consumer's
   * `loadDoc` / `fromJSON` over its own stored state): rendered
   * read-only over the "published" mode (a static stand — no sync
   * transport). Must not change after mount (like `doc`): a new
   * snapshot is a consumer remount over a `key` change.
   */
  publishedDoc?: Doc | null;
  /**
   * The published stand's selection policy (default `false`): `true` makes
   * the published snapshot's page text selectable and copyable — the
   * `view` mode's parity (the native range over the non-editable inners,
   * the editor's copy payload: marks, `@label` mentions, cross-block
   * ranges, and the table's grid serialization), so the consumer decides
   * per reader whether the published state may be quoted. The canvas
   * world keeps the no-select stand in every mode. Session state supplied
   * by the consumer — never document data. A nested provider without its
   * own stand inherits the enclosing one.
   */
  publishedCopyable?: boolean;
  /**
   * Optional presence identity + the selection-sharing cipher (consumer
   * session state, never document data): the local user's stable `userId`
   * (the addressable identity on the wire), the optional roster label, and
   * the optional `PresenceCrypto` cipher (without it a targeted grant
   * degrades to "off" / "everyone": the hook's setter stands a no-op over
   * a targeted grant without the identity or the cipher). With the prop
   * the selection sharing grant is session state
   * driven through `usePresenceSharing()` (the default "off" — the
   * privacy stand); without it the provider keeps the legacy stand (the
   * anonymous plaintext selection — always shared over the room).
   *
   * Like the other customization values, the value is read per render:
   * pass a stable reference.
   */
  presence?: PresenceConfig;
}

export type { EditorProviderAccessProps };
