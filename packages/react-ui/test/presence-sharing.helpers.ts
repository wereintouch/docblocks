// The presence sharing tests' shared stand: the fake transport's awareness
// capture, the stub cipher's per-target entries, the selection's caret,
// and the per-test cleanup.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import type { PresenceSelection, PresenceState, SyncProvider } from "docblocks-core";

import type { PresenceCrypto } from "../src/presence";

const CREATED_AT = "2026-11-09T00:00:00.000Z";

/** A fake transport capturing every setAwareness payload (plus the awareness channel). */
function makePublishingProvider() {
  const published: Record<string, unknown>[] = [];
  let awarenessCb: ((peers: PresenceState[]) => void) | null = null;
  const provider: SyncProvider = {
    connect: async () => {},
    disconnect: () => {},
    sendUpdate: () => {},
    onUpdate: () => () => {},
    getLocalStateVector: () => new Uint8Array(),
    setAwareness: (state) => {
      published.push(state);
    },
    onAwareness: (cb) => {
      awarenessCb = cb;
      return () => {
        awarenessCb = null;
      };
    },
  };
  return { provider, published, emit: (peers: PresenceState[]) => awarenessCb?.(peers) };
}

/** The stub cipher: an entry is addressed to exactly one user (`enc:<target>:<sender>:<json>`); the recipient's decrypt opens it only when the entry is addressed to them. */
const stubCrypto = (myUserId: string): PresenceCrypto => {
  return {
    encrypt: async (selection, grant) =>
      grant.map((target) => `enc:${target}:${myUserId}:${JSON.stringify(selection)}`),
    decrypt: async (entry) => {
      const match = /^enc:([^:]*):([^:]*):([\s\S]*)$/.exec(entry);
      if (match === null || match[1] !== myUserId || match[3] === undefined) return null;
      return JSON.parse(match[3]) as PresenceSelection;
    },
  };
};

const caret = (blockId: string, offset: number): PresenceSelection => ({ blockId, offset });

afterEach(cleanup);

export { CREATED_AT, caret, makePublishingProvider, stubCrypto };
