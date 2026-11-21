/**
 * The frontmatter header's mapping to the document's meta: the known keys
 * (the title / the description / the tags / the created-by reference / the
 * dates / the status) over the confirmed stand, the custom keys over the
 * attributes' record, the unsupported shapes over the JSON string (the
 * data's loss stand), and the empty-document's gate (the import / the
 * paste's stand).
 */
import type { BlockId, Doc, DocAttributeValue } from "docblocks-core";

import type { FrontmatterValue } from "./frontmatter";

/** The mapped document meta (the import / the paste's write input). */
interface FrontmatterMeta {
  title?: string;
  attributes: Record<string, DocAttributeValue>;
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
 * deduplicated); `author` / `created_by` (the string / the name object) →
 * the `createdBy` mention reference (id-only — the consumer's resolution
 * stands the display label); `date` / `lastmod` / `updated` →
 * `publishedAt` (the parseable
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
  let createdBy: DocAttributeValue | undefined;
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
      case "created_by":
      case "createdBy":
        if (createdBy === undefined) createdBy = createdByValueOf(value);
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
  if (createdBy !== undefined) attributes.createdBy = createdBy;
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

/** The `createdBy`'s mention reference (the id-only stand — the string /
 *  the name object's stand; the display label is the consumer's
 *  resolution). */
function createdByValueOf(value: FrontmatterValue): DocAttributeValue {
  if (typeof value === "string") {
    const id = value.trim();
    return id === "" ? "" : { id };
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const id = record.id ?? record.name;
    if (typeof id === "string" && id !== "") return { id };
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

export { isFreshForMeta, mapFrontmatter };
export type { FrontmatterMeta };
