// The in-memory reference bridge's surface: the factory (the harness's
// single-process stand of the `DatabaseBridge` contract) + the options'
// shape. The harness passes the bridge to the editor explicitly (the
// `databaseBridge` prop) — the editor renders the external-form database
// block over the consumer's bridge, never over a package default.
export { createMemoryDatabaseBridge } from "./memory-bridge";
export type { MemoryDatabaseBridge } from "./memory-bridge";
export type { MemoryBridgeOptions } from "./models";
