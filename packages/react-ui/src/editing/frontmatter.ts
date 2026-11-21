/**
 * The markdown frontmatter subset (hand-rolled — no YAML dependency): the
 * `--- ... ---` header at the source's start and the `key: value` entries
 * — the scalars (the plain / quoted strings, the booleans, the numbers),
 * the block scalars (the `|` / `>`'s indented lines), the inline `[a, b]`
 * and the block `- item` string lists, the one-level nested objects (the
 * JSON string's stand — the data is never lost), and the inline comments.
 * The mapping to the document's meta (the `title` + the `attributes`
 * record) and the empty-document's stand (the import / the paste's gate).
 * The header is stripped before the blocks' parse (a leading `---` would
 * otherwise stand the divider's / the setext's discriminator). The
 * `__proto__` key stands dropped: the entries live in plain objects, where
 * the assignment would write the prototype chain instead of an own entry.
 */
/** A frontmatter entry's parsed value (the mapping's input): the scalars,
 *  the string lists, and the one-level nested objects. */
interface FrontmatterObject {
  [key: string]: FrontmatterValue;
}

type FrontmatterValue = string | number | boolean | string[] | FrontmatterObject;

/** The parsed header: the entries + the body (the source minus the header). */
interface ParsedFrontmatter {
  entries: Record<string, FrontmatterValue>;
  /** The source without the header (the blocks' parse input). */
  body: string;
}
const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:\s+(.*))?$/;

/** The unquoted scalar's parse (the boolean / the number / the inline list / the plain string). */
function parseScalar(raw: string): FrontmatterValue {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // The inline comment (the unquoted values only: a space + `#`).
  const commentAt = trimmed.search(/\s+#/);
  const value = commentAt >= 0 ? trimmed.slice(0, commentAt).trim() : trimmed;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return "";
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return inner
      .split(",")
      .map((item) => parseScalar(item))
      .map((item): string => (typeof item === "string" ? item : String(item)));
  }
  return unquote(value);
}

/** The quoted string's unquote (the double / the single quotes). */
function unquote(value: string): string {
  if (value.length >= 2) {
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\"/g, '"');
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** The key the parser drops (the documented stand): a plain object's
 *  `__proto__` assignment writes the prototype chain, never an own entry. */
const RESERVED_KEY = "__proto__";

/** The entry's write: the reserved key stands dropped. */
function setEntry(target: Record<string, FrontmatterValue>, key: string, value: FrontmatterValue): void {
  if (key === RESERVED_KEY) return;
  target[key] = value;
}

/** The header's presence check (the first line is the `---`'s fence). */
const HEADER_OPEN = /^---\s*$/;

/**
 * Parses the leading frontmatter header; `null` when the source does not
 * start with the header (the body stands the full source, unchanged).
 */
function parseFrontmatter(source: string): ParsedFrontmatter | null {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length === 0 || !HEADER_OPEN.test(lines[0]!.trim())) return null;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i]!.trim())) {
      close = i;
      break;
    }
  }
  if (close === -1) return null;
  const body = lines.slice(close + 1).join("\n");
  const entries: Record<string, FrontmatterValue> = {};
  const headerLines = lines.slice(1, close);
  let i = 0;
  while (i < headerLines.length) {
    const line = headerLines[i]!;
    const trimmed = line.trim();
    i += 1;
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = KEY_LINE.exec(trimmed);
    if (match === null) continue;
    const key = match[1]!;
    const rawValue = match[2]?.trim() ?? "";
    if (rawValue === "" || rawValue === "|" || rawValue.startsWith(">")) {
      // The block scalar (the `|` / `>`'s indented lines) or the nested
      // block (the `- item` / `k: v`'s indented lines).
      const block: string[] = [];
      let indent = -1;
      while (i < headerLines.length) {
        const next = headerLines[i]!;
        if (next.trim() === "") {
          block.push("");
          i += 1;
          continue;
        }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent === 0) break;
        if (indent === -1) indent = nextIndent;
        block.push(next.slice(Math.min(indent, nextIndent)));
        i += 1;
      }
      const content = block.join("\n").trimEnd();
      if (content === "") {
        // The bare key (no value, no nested lines): the empty scalar.
        setEntry(entries, key, "");
        continue;
      }
      if (rawValue === "") {
        // The nested block: the list (the `- item` lines) or the object.
        const items = content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "");
        if (items.every((item) => item.startsWith("- "))) {
          setEntry(
            entries,
            key,
            items.map((item) => unquote(item.slice(2).trim()))
          );
        } else {
          const object: Record<string, FrontmatterValue> = {};
          for (const item of items) {
            const entry = KEY_LINE.exec(item);
            if (entry !== null) setEntry(object, entry[1]!, parseScalar(entry[2] ?? ""));
          }
          setEntry(entries, key, Object.keys(object).length > 0 ? object : content);
        }
      } else {
        setEntry(entries, key, rawValue.startsWith(">") ? content.replace(/\n+/g, " ").trim() : content);
      }
      continue;
    }
    setEntry(entries, key, parseScalar(rawValue));
  }
  return { entries, body };
}
export { isFreshForMeta, mapFrontmatter } from "./frontmatter-meta";
export { parseFrontmatter };
export type { FrontmatterMeta } from "./frontmatter-meta";
export type { FrontmatterObject, FrontmatterValue, ParsedFrontmatter };
