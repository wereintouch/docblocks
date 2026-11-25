/**
 * The dev relay's trust gate (a non-loopback bind's token + the local
 * origin's check + the header's normalization): the relay must not be a
 * network DoS vector — an explicit non-loopback bind requires a token, and
 * the ws upgrade / the HTTP control admit local origins only (a foreign
 * page cannot open a room or drive the control).
 */

/** True when the bind host is a loopback address (127.0.0.1 / ::1 / localhost). */
function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** The token gate for a non-loopback bind: the ws upgrade carries the token
 * as a `?token=` query param, the HTTP control as an `x-relay-token` header. */
function tokenMatches(url: string | null | undefined, header: string | undefined, token: string): boolean {
  if (header === token) return true;
  if (url !== null && url !== undefined) {
    try {
      return new URL(url, "http://localhost").searchParams.get("token") === token;
    } catch {
      return false;
    }
  }
  return false;
}

/** Normalize a (possibly multi-valued) header to its first string value. */
function firstHeader(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

export { firstHeader, isLoopbackHost, tokenMatches };
