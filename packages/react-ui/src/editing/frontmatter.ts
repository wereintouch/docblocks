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
 * otherwise stand the divider's / the setext's discriminator).
 */
import type { BlockId, Doc, DocAttributeValue } from "docblocks-core";

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
/** The mapped document meta (the import / the paste's write input). */
interface FrontmatterMeta {
  title?: string;
  attributes: Record<string, DocAttributeValue>;
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
        entries[key] = "";
        continue;
      }
      if (rawValue === "") {
        // The nested block: the list (the `- item` lines) or the object.
        const items = content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "");
        if (items.every((item) => item.startsWith("- "))) {
          entries[key] = items.map((item) => unquote(item.slice(2).trim()));
        } else {
          const object: Record<string, FrontmatterValue> = {};
          for (const item of items) {
            const entry = KEY_LINE.exec(item);
            if (entry !== null) object[entry[1]!] = parseScalar(entry[2] ?? "");
          }
          entries[key] = Object.keys(object).length > 0 ? object : content;
        }
      } else {
        entries[key] = rawValue.startsWith(">") ? content.replace(/\n+/g, " ").trim() : content;
      }
      continue;
    }
    entries[key] = parseScalar(rawValue);
  }
  return { entries, body };
}

/** The date's ISO stand (the `YYYY-MM-DD` / the ISO date-time's parse). */
const toIsoDate = (value: string): string | null => {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) return null;
  const parsed = Date.parse(trimmed.replace(" ", "T"));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

/**
 * The header's mapping to the document's meta: `title` → the document's title; `description` / `summary`
 * / `excerpt` → `description`; `tags` / `keywords` → `tags` (merged and
 * deduplicated); `author` (the string / the name object) → the mention
 * reference; `date` / `lastmod` / `updated` → `publishedAt` (the parseable
 * date's ISO — the unparseable stands the custom key under its name);
 * `draft` / `published` → `status`; `cover` / `image` / `banner` → the
 * custom key (the raw URL — NOT the `cover` file id); the nested objects →
 * the JSON string (the data's loss stand); everything else → the custom
 * attribute.
 */
function mapFrontmatter(entries: Record<string, FrontmatterValue>): FrontmatterMeta {
  const attributes: Record<string, DocAttributeValue> = {};
  let title: string | undefined;
  let description: string | undefined;
  const tags: string[] = [];
  let author: DocAttributeValue | undefined;
  let publishedAt: string | undefined;
  let status: string | undefined;

  for (const [key, value] of Object.entries(entries)) {
    switch (key) {
      case "title":
        if (typeof value === "string" && value !== "") title = value;
        else if (Array.isArray(value) || typeof value === "object") attributes[key] = JSON.stringify(value);
        else attributes[key] = value;
        break;
      case "description":
      case "summary":
      case "excerpt":
        if (description === undefined && (typeof value === "string" || typeof value === "number"))
          description = String(value);
        else attributes[key] = attributeValueOf(value);
        break;
      case "tags":
      case "keywords": {
        const list = typeof value === "string" ? [value] : Array.isArray(value) ? value.map(String) : [];
        for (const tag of list) if (!tags.includes(tag)) tags.push(tag);
        break;
      }
      case "author":
        if (author === undefined) author = authorValueOf(value);
        break;
      case "date":
      case "lastmod":
      case "updated": {
        if (publishedAt === undefined && typeof value === "string") {
          const iso = toIsoDate(value);
          if (iso !== null) publishedAt = iso;
          else attributes[key] = value;
        } else attributes[key] = attributeValueOf(value);
        break;
      }
      case "draft":
        if (status === undefined && value === true) status = "draft";
        else if (status === undefined && typeof value === "string" && value === "true") status = "draft";
        break;
      case "published":
        if (status === undefined && (value === true || (typeof value === "string" && value === "true")))
          status = "published";
        else if (status === undefined && (value === false || (typeof value === "string" && value === "false"))) {
          // The explicit "not published" stands no status (the absence).
        }
        break;
      case "cover":
      case "image":
      case "banner":
        // The raw URL stand (the consumer's store's file id is the `cover`
        // preset's contract — the frontmatter's URL is a custom attribute
        // under its own key).
        if (typeof value === "string" && value !== "") attributes[key] = value;
        else attributes[key] = attributeValueOf(value);
        break;
      default:
        attributes[key] = attributeValueOf(value);
        break;
    }
  }

  if (description !== undefined) attributes.description = description;
  if (tags.length > 0) attributes.tags = tags;
  if (author !== undefined) attributes.author = author;
  if (publishedAt !== undefined) attributes.publishedAt = publishedAt;
  if (status !== undefined) attributes.status = status;

  return { title, attributes };
}

/** The frontmatter's value → the attribute value (the unsupported shapes
 *  stand the JSON string — the data's loss stand). */
function attributeValueOf(value: FrontmatterValue): DocAttributeValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : String(item)));
  return JSON.stringify(value);
}

/** The `author`'s mention reference (the string / the name object's stand). */
function authorValueOf(value: FrontmatterValue): DocAttributeValue {
  if (typeof value === "string") {
    const label = value.trim();
    return label === "" ? "" : { id: label, label };
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const name = value.name;
    if (typeof name === "string" && name !== "") return { id: name, label: name };
  }
  return attributeValueOf(value);
}

/**
 * The empty-document's stand (the frontmatter's gate): the root holds the
 * empty room (no children — the import's stand) or the single empty
 * starter paragraph (the paste's seat — the caret's block, empty and a
 * paragraph over the document's root).
 */
function isFreshForMeta(doc: Doc, seatId?: BlockId): boolean {
  const rootId = doc.meta.id;
  const children = doc.getChildren(rootId);
  if (children.length === 0) return true;
  if (children.length === 1 && seatId !== undefined && children[0] === seatId) {
    const seat = doc.getBlock(seatId);
    return seat !== null && seat.type === "paragraph" && doc.getText(seatId) === "";
  }
  return false;
}

export { isFreshForMeta, mapFrontmatter, parseFrontmatter };
export type { FrontmatterMeta, FrontmatterObject, FrontmatterValue, ParsedFrontmatter };
