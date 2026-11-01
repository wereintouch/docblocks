// The in-memory reference bridge's cross-unit surface: the factory (the
// contract's single-process stand) + the per-page default (the
// `databaseBridge` prop fallback) + the options' shape.
export { createMemoryDatabaseBridge, getDefaultDatabaseBridge } from "./memory-bridge";
export type { MemoryDatabaseBridge } from "./memory-bridge";
export type { MemoryBridgeOptions } from "./models";
