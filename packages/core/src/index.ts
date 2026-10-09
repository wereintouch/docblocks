/**
 * docblocks-core — public entry (headless).
 *
 * Layers (imports only downward): schema <- core <- sync.
 */
export * from "./schema";
export * from "./core";
export * from "./sync";

/** Stable package marker (useful for diagnostics). */
export const PACKAGE = "docblocks-core" as const;
