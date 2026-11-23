/**
 * The ws-relay's fixtures (the sibling of ws-relay.ts): the fake socket
 * the relay drives (the provider sees the WsLike surface) and the
 * deterministic PRNG utilities the chaos hooks use. The relay's mechanics
 * stand in ws-relay-rooms.ts.
 */

/** A fake socket the relay drives; the provider sees the WsLike surface. */
interface FakeSocket {
  url: string;
  closed: boolean;
  opened: boolean;
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: Uint8Array }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
/** Deterministic PRNG (mulberry32) for reproducible chaos. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], prng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export { mulberry32, shuffled };
export type { FakeSocket };
