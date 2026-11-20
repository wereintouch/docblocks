/** The sync-embed / embed-container contracts: the master-doc resolver
 *  and the embed sandbox policy. */
import type { Doc, SyncEmbedRef } from "docblocks-core";

/**
 * Resolves a sync-embed ref to the master doc the consumer holds; null when
 * the master is unknown to the consumer (the block renders its broken state).
 */
type SyncEmbedResolver = (ref: SyncEmbedRef) => Doc | null;

/** The embed sandbox policy: the iframe's `sandbox` value for a given embed
 *  src; `null` stands no sandbox (a fully trusted embed, the old behavior). */
type EmbedSandboxPolicy = (src: string) => string | null;

export type { EmbedSandboxPolicy, SyncEmbedResolver };
