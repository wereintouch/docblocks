/**
 * The bridge's structured error: the stable machine-readable code +
 * the safe message (no stack trace, SQL or tenant details) + the optional
 * retry hint / the failed field's path. The transport serializes the error
 * as the rejected result; `toBridgeError` normalizes an unknown rejection
 * to the same shape.
 */

/**
 * The stable error codes. The client's rule per code group: `validation` /
 * `protocol_mismatch` — show, no retry; `not_found` / `forbidden` — stop,
 * clear the sensitive state; `conflict` — rebaseline and offer the retry;
 * `idempotency_conflict` — no automatic retry; `idempotency_expired` /
 * `operation_unknown` — rebaseline, never a new operation;
 * `limit_exceeded` / `payload_too_large` — shrink the request, no retry
 * unchanged; `cursor_expired` / `replay_expired` — discard the page /
 * cursor and take a fresh snapshot; `transient` / `unavailable` /
 * `timeout` — retry only with the same operationId; `enum.option_in_use`
 * — show, no retry (the delete's default refusal; the explicit
 * replacement migration is the consumer's separate operation).
 */
type BridgeErrorCode =
  | "validation"
  | "invalid_filter"
  | "invalid_operator"
  | "invalid_column"
  | "protocol_mismatch"
  | "limit_exceeded"
  | "payload_too_large"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "idempotency_conflict"
  | "idempotency_expired"
  | "operation_unknown"
  | "cursor_expired"
  | "replay_expired"
  | "transient"
  | "unavailable"
  | "timeout"
  | "enum.option_in_use";

/** Every code of the set (the closed vocabulary). */
const BRIDGE_ERROR_CODES: readonly BridgeErrorCode[] = [
  "validation",
  "invalid_filter",
  "invalid_operator",
  "invalid_column",
  "protocol_mismatch",
  "limit_exceeded",
  "payload_too_large",
  "not_found",
  "forbidden",
  "conflict",
  "idempotency_conflict",
  "idempotency_expired",
  "operation_unknown",
  "cursor_expired",
  "replay_expired",
  "transient",
  "unavailable",
  "timeout",
  "enum.option_in_use",
];

/** The structured bridge error (the rejection of every contract method). */
class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly retryAfter?: number;
  readonly path?: string;

  constructor(
    code: BridgeErrorCode,
    message: string,
    options?: { retryAfter?: number; path?: string; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "BridgeError";
    this.code = code;
    this.retryAfter = options?.retryAfter;
    this.path = options?.path;
  }
}

/** The code membership (the closed vocabulary's guard). */
function isBridgeErrorCode(value: unknown): value is BridgeErrorCode {
  return typeof value === "string" && (BRIDGE_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * The error's guard: the class instance or the plain serialized shape
 * (the wire-rehydrated `{ code, message }` object).
 */
function isBridgeError(error: unknown): error is BridgeError {
  if (error instanceof BridgeError) return true;
  return typeof error === "object" && error !== null && isBridgeErrorCode((error as { code?: unknown }).code);
}

/**
 * Normalizes an unknown rejection to the contract's error. A rejection
 * that carries no recognizable machine code is a transport-level failure
 * (the write's outcome is unknown) and stands the `unavailable` group: the
 * safe recovery is the same-operationId reconciliation, not a blind new
 * operation.
 */
function toBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown; retryAfter?: unknown; path?: unknown };
    if (isBridgeErrorCode(candidate.code)) {
      return new BridgeError(
        candidate.code,
        typeof candidate.message === "string" ? candidate.message : "The request failed.",
        {
          retryAfter: typeof candidate.retryAfter === "number" ? candidate.retryAfter : undefined,
          path: typeof candidate.path === "string" ? candidate.path : undefined,
          cause: error,
        }
      );
    }
  }
  return new BridgeError("unavailable", error instanceof Error ? error.message : String(error), { cause: error });
}

export { BridgeError, BRIDGE_ERROR_CODES, isBridgeError, isBridgeErrorCode, toBridgeError };
export type { BridgeErrorCode };
