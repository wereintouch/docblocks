/** The page cursor's signing stand: the keyless FNV-1a fingerprint could not
 *  bind the cursor to the issuer — every bound value (the snapshot R, the
 *  filter, the sort) and the fingerprint itself stand unkeyed, so a
 *  coordinated rewrite of the payload plus the fingerprint passed the
 *  integrity check. The HMAC-SHA256 signature under the instance's key
 *  replaces the keyless stand: the cursor and the query fingerprint are
 *  unforgeable without the key. */
import type { FilterInput, SortInput } from "../bridge";
import { canonicalJson } from "./utils";

/** The signed cursor's format version (the `v3:` prefix). */
const CURSOR_VERSION_PREFIX = "v3:";

/** The signature's base64url encoding (the token stays URL-safe). */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array | null {
  try {
    const binary = atob(input.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** The pure SHA-256 (FIPS 180-4) over a byte string — the platform's
 *  `crypto.subtle` stand for the SSR / the non-secure-context runtimes. */
function sha256(bytes: Uint8Array): Uint8Array {
  const MASK32 = 0xffffffff;
  const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ];

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a;
  let h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const totalLength = bytes.length;
  const bitLength = totalLength * 8;
  const paddedLength = (((totalLength + 8) >> 6) + 1) << 6;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[totalLength] = 0x80;
  // The 64-bit big-endian bit length (the high 32 bits stand zero — the
  // signed token never exceeds the 2^32-bit stand).
  for (let i = 0; i < 4; i++) data[paddedLength - 4 + i] = (bitLength >>> (8 * (3 - i))) & 0xff;

  const w = new Array<number>(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t++)
      w[t] =
        ((data[offset + t * 4]! << 24) |
          (data[offset + t * 4 + 1]! << 16) |
          (data[offset + t * 4 + 2]! << 8) |
          data[offset + t * 4 + 3]!) &
        MASK32;
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) & MASK32;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[t]! + w[t]!) & MASK32;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) & MASK32;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK32;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK32;
    }
    h0 = (h0 + a) & MASK32;
    h1 = (h1 + b) & MASK32;
    h2 = (h2 + c) & MASK32;
    h3 = (h3 + d) & MASK32;
    h4 = (h4 + e) & MASK32;
    h5 = (h5 + f) & MASK32;
    h6 = (h6 + g) & MASK32;
    h7 = (h7 + h) & MASK32;
  }

  const digest = new Uint8Array(32);
  const state = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    const value = state[i]!;
    digest[i * 4] = (value >>> 24) & 0xff;
    digest[i * 4 + 1] = (value >>> 16) & 0xff;
    digest[i * 4 + 2] = (value >>> 8) & 0xff;
    digest[i * 4 + 3] = value & 0xff;
  }
  return digest;
}

/** The HMAC-SHA256 (RFC 2104) under a byte key. */
function hmacSha256(key: Uint8Array, message: string): Uint8Array {
  const BLOCK_SIZE = 64;
  const normalized = key.length > BLOCK_SIZE ? sha256(key) : key;
  const messageBytes = new TextEncoder().encode(message);
  const ipad = new Uint8Array(BLOCK_SIZE).fill(0x36);
  const opad = new Uint8Array(BLOCK_SIZE).fill(0x5c);
  // The key pads to the block with zeros (the RFC 2104's short-key stand) —
  // only the key's bytes enter the XOR.
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const byte = i < normalized.length ? normalized[i]! : 0;
    ipad[i]! ^= byte;
    opad[i]! ^= byte;
  }
  const inner = new Uint8Array(BLOCK_SIZE + messageBytes.length);
  inner.set(ipad);
  inner.set(messageBytes, BLOCK_SIZE);
  const outer = new Uint8Array(BLOCK_SIZE + 32);
  outer.set(opad);
  outer.set(sha256(inner), BLOCK_SIZE);
  return sha256(outer);
}

/** The constant-time comparison (the signature stand: no early exit). */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** The signature over the canonical payload (the base64url HMAC). */
function sign(key: Uint8Array, payload: string): string {
  return base64UrlEncode(hmacSha256(key, payload));
}

/** The cursor payload (the signed stand: every field is issuer-issued —
 *  the client never constructs one). */
interface CursorPayload {
  v: number;
  tableId: string;
  /** The snapshot boundary `R` the page was cut at (the envelope `seq`). */
  R: number;
  /** The query fingerprint the page was cut under (the keyed stand). */
  fp: string;
  filter: FilterInput | null;
  sort: SortInput | null;
  limit: number;
  /** The last row of the page: the continuation position (exclusive);
   *  null stands the sequence head (the first page was empty). */
  afterOrderKey: number | null;
  afterRowId: string | null;
}

/** The signed token's shape: `v3:<canonicalJson>.<signature>`. */
function signCursor(key: Uint8Array, payload: Omit<CursorPayload, "v">): string {
  const body = canonicalJson({ v: 3, ...payload });
  return `${CURSOR_VERSION_PREFIX}${body}.${sign(key, body)}`;
}

/** The token's verification (null = the foreign version, the malformed
 *  shape, or the failed signature); the caller stands the expiry / the
 *  fingerprint / the boundary checks over the verified payload. */
function verifyCursor(key: Uint8Array, cursor: string): CursorPayload | null {
  if (!cursor.startsWith(CURSOR_VERSION_PREFIX)) return null;
  const rest = cursor.slice(CURSOR_VERSION_PREFIX.length);
  const separator = rest.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = rest.slice(0, separator);
  const signature = base64UrlDecode(rest.slice(separator + 1));
  if (signature === null || !constantTimeEqual(signature, hmacSha256(key, body))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const payload = parsed as Partial<CursorPayload>;
  if (
    payload.v !== 3 ||
    typeof payload.tableId !== "string" ||
    typeof payload.R !== "number" ||
    typeof payload.fp !== "string" ||
    typeof payload.limit !== "number" ||
    (payload.afterOrderKey !== null && typeof payload.afterOrderKey !== "number") ||
    (payload.afterRowId !== null && typeof payload.afterRowId !== "string")
  ) {
    return null;
  }
  return payload as CursorPayload;
}

/** The keyed query fingerprint (the server's signed canonical form — the
 *  client never constructs one). */
function queryFingerprintOf(key: Uint8Array, canonicalBody: unknown): string {
  return `fp-${sign(key, canonicalJson(canonicalBody))}`;
}

/** The fresh instance key (the platform's CSPRNG; the `cursorKey`'s
 *  absent stand). */
function randomKeyBytes(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

export { queryFingerprintOf, randomKeyBytes, signCursor, verifyCursor };
export type { CursorPayload };
