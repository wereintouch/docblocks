import type { PresenceCrypto } from "docblocks-react-ui";

import type { PresenceSelection } from "docblocks-core";

/** The stub entry's payload: the addressed user id + the plaintext selection. */
interface StubEntry {
  /** The addressed user id (the recipient's decrypt opens only its own entry). */
  t: string;
  /** The plaintext selection. */
  s: PresenceSelection;
}

const encode = (value: string): string => btoa(encodeURIComponent(value));
const decode = (value: string): string => decodeURIComponent(atob(value));

/**
 * The harness's selection cipher (the selection-sharing's orchestration's
 * stand — the demo, not the cryptography: a base64 payload carrying the
 * addressed user id; the recipient's decrypt opens only the entry
 * addressed to it, a non-recipient's stands null — the targeted's privacy
 * property over the stub).
 */
function stubPresenceCrypto(userId: string): PresenceCrypto {
  return {
    encrypt: async (selection, grant) => grant.map((target) => encode(JSON.stringify({ t: target, s: selection }))),
    decrypt: async (entry) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(decode(entry));
      } catch {
        return null;
      }
      const record = parsed as Partial<StubEntry>;
      if (typeof record.t !== "string" || record.t !== userId || record.s === undefined) return null;
      return record.s;
    },
  };
}

export { stubPresenceCrypto };
