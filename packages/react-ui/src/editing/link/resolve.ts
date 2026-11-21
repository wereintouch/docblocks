/** The link popover's input's resolution (the smart scheme's inference):
 * the explicit scheme (the `mailto:` / the `tel:` / the web's URL's form)
 * passes over the core's gate as-is; the protocol-relative form (the
 * leading slash / backslash pair) stands the explicit `https://`'s stand
 * (the stored href is self-describing — the reader's scheme never decides
 * it); the leading `/` / `#` / `.` stands the relative's form; the email's form (the `@` without the whitespace)
 * stands the `mailto:`; the phone's form (the digits + the separators, no
 * letters) stands the `tel:`; the bare's form (a domain / a path's text)
 * stands the `https://`'s prefix. `null` stands the rejection (the
 * popover's invalid's stand). */
import { isSafeLinkHref } from "docblocks-core";

/** The explicit scheme's prefix (the `mailto:` / the `tel:` / the web's
 * URL's discriminator — the scheme's case-insensitive stand). */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;

/** The protocol-relative form (the browser's special-scheme's slash /
 *  backslash equivalence — an absolute URL over the reader's scheme). */
const PROTOCOL_RELATIVE = /^[/\\]{2}/;

/** The phone's form: 5–20 characters of digits and the phone's separators
 * (no letters) — the versions' / the dates' tokens stand the https's
 * form over it (the digits' minimum is checked over the call). */
const PHONE_FORM = /^[0-9()+\-'., ]{5,20}$/;

/** The minimum digit count of the phone's form (the `tel:`'s payload's
 * parity over the core's contract). */
const PHONE_MIN_DIGITS = 5;

function resolveLinkHref(input: string): string | null {
  const value = input.trim();
  if (value === "") return null;
  // The explicit scheme: as-is over the core's gate (the `javascript:`'s
  // / the custom deep-link's forms stand the rejection).
  if (SCHEME_PREFIX.test(value)) return isSafeLinkHref(value) ? value : null;
  // The protocol-relative form: the browser would resolve it against the
  // reader's scheme — the explicit https's stand keeps the data
  // self-describing (the backslash pair is the parser's slash equivalence).
  if (PROTOCOL_RELATIVE.test(value)) {
    const web = `https://${value.slice(2)}`;
    return isSafeLinkHref(web) ? web : null;
  }
  // The relative's forms (the internal's paths / the fragments' stand).
  if (value.startsWith("/") || value.startsWith("#") || value.startsWith(".")) {
    return isSafeLinkHref(value) ? value : null;
  }
  // The email's form (the `@`'s presence over the no-whitespace's token).
  if (value.includes("@") && !/\s/.test(value)) {
    const href = `mailto:${value}`;
    return isSafeLinkHref(href) ? href : null;
  }
  // The phone's form (the digits + the separators, the no-letters' stand).
  if (PHONE_FORM.test(value) && (value.match(/\d/g) ?? []).length >= PHONE_MIN_DIGITS) {
    const href = `tel:${value}`;
    return isSafeLinkHref(href) ? href : null;
  }
  // The bare's form: the web's URL over the `https://`'s prefix (the
  // single-token's stand — the multi-word's input stands the invalid's
  // stand, the no-space's URL's form).
  if (/\s/.test(value)) return null;
  const web = `https://${value}`;
  return isSafeLinkHref(web) ? web : null;
}

export { resolveLinkHref };
