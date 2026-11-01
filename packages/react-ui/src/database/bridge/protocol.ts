/**
 * The protocol's negotiation: the protocol's version, the baseline
 * capabilities every conformant bridge declares, the bridge's type guard
 *, and the descriptor's
 * validation (the version / capability mismatch rejects with
 * `protocol_mismatch` — the silent downgrade is not a stand).
 */
import { BridgeError } from "./errors";
import type { DatabaseBridge, ProtocolCapability, ProtocolDescriptor } from "./models";

/** The protocol's version. */
const PROTOCOL_VERSION = 2;

/** The capabilities every conformant bridge declares (the baseline:
 *  the ordered rows, the snapshot → replay bootstrap, the idempotent
 *  writes, the structured errors, and the view invalidation). */
const BASELINE_CAPABILITIES = [
  "orderedRows",
  "snapshotReplay",
  "idempotentWrites",
  "structuredErrors",
  "viewInvalidation",
] as const satisfies readonly ProtocolCapability[];

/** The bridge's guard (a pre-contract bridge object stands none of the discriminators). */
function isDatabaseBridge(candidate: unknown): candidate is DatabaseBridge {
  if (typeof candidate !== "object" || candidate === null) return false;
  const bridge = candidate as Record<string, unknown>;
  return (
    typeof bridge.describeProtocol === "function" &&
    typeof bridge.snapshotTable === "function" &&
    typeof bridge.batchRows === "function"
  );
}

/**
 * Validates the negotiated descriptor: the protocol version 2 + every
 * baseline capability. Returns the capability set the UI gates its
 * optional paths on (the `rowRestore` / `columnRestore` / `mixedBatch` /
 * `cas` / `serverSort` stands). A mismatched version or a missing baseline
 * capability rejects with `protocol_mismatch`.
 */
function validateProtocolDescriptor(descriptor: ProtocolDescriptor): Set<ProtocolCapability> {
  if (descriptor.protocolVersion !== PROTOCOL_VERSION) {
    throw new BridgeError(
      "protocol_mismatch",
      `The bridge's protocol version ${String(descriptor.protocolVersion)} is not supported (the client requires ${PROTOCOL_VERSION}).`
    );
  }
  const capabilities = new Set<ProtocolCapability>(descriptor.capabilities);
  for (const capability of BASELINE_CAPABILITIES) {
    if (!capabilities.has(capability)) {
      throw new BridgeError("protocol_mismatch", `The bridge lacks the required protocol capability "${capability}".`);
    }
  }
  return capabilities;
}

export { BASELINE_CAPABILITIES, PROTOCOL_VERSION, isDatabaseBridge, validateProtocolDescriptor };
