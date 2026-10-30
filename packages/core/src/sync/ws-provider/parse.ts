/** The wire selection parsing, the decode-error guard, and the default socket
 *  factory. */
import type { PresenceSelection } from "../models";
import type { WsLike } from "./models";

/** Decode errors inside a sync message do not tear the connection down. */
const swallowDecodeError = (): undefined => undefined;

const isPoint = (value: unknown): value is { blockId: string; offset: number } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).blockId === "string" &&
  typeof (value as Record<string, unknown>).offset === "number";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** Validate an untrusted wire selection; null when the shape is not one of the wire forms. */
function parseSelection(value: unknown): PresenceSelection | null {
  if (typeof value !== "object" || value === null) return null;
  const sel = value as Record<string, unknown>;
  if (typeof sel.blockId === "string" && typeof sel.offset === "number") {
    return { blockId: sel.blockId, offset: sel.offset };
  }
  if (isPoint(sel.from) && isPoint(sel.to)) {
    const range: PresenceSelection = { from: sel.from, to: sel.to };
    if (isStringArray(sel.blocks)) range.blocks = [...sel.blocks];
    return range;
  }
  if (isStringArray(sel.blocks)) return { blocks: [...sel.blocks] };
  return null;
}

/** The default socket factory: the global WebSocket, normalized to WsLike. */
const defaultWebSocketImpl = (url: string): WsLike => {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const like: WsLike = {
    send: (data: Uint8Array) => ws.send(data as Uint8Array<ArrayBuffer>),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = (ev) => like.onopen?.(ev);
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) like.onmessage?.({ data: new Uint8Array(ev.data) });
    // non-binary frames carry no sync payload
  };
  ws.onclose = (ev) => like.onclose?.(ev);
  ws.onerror = (ev) => like.onerror?.(ev);
  return like;
};

export { defaultWebSocketImpl, parseSelection, swallowDecodeError };
