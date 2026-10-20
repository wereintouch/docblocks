/**
 * The schema validator's public entry: validateDoc (the strict whole-doc
 * check) + the per-block / per-mark entry points. The implementation stands
 * in `./utils/` (doc / blocks / content / common) over the shared
 * `./models` types and constants.
 */
export * from "./utils";
export type { ValidationError } from "./models";
