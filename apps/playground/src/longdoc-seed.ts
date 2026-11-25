import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { DEMO_IMAGE_KEYS } from "./blob-fixtures";
import { deterministicIdGenerator } from "./catalog";

const DOC_ID = "d1";
const DOC_CREATED_AT = "2026-01-01T00:00:00Z";

/** The long-document seed's block count (`?longdoc=1`): the windowing
 *  baseline's default scale; `?longdoc=<n>` stands another count. */
const LONGDOC_DEFAULT_COUNT = 200;

/** The seed's scale cap (the seed is one transact; a typo must not build a
 *  million blocks). */
const LONGDOC_MAX_COUNT = 2_000;

/** The heading / intro / trailing text the images sit between. */
const INTRO_PARAGRAPH = "Long document: the windowing baseline stand (the images stand the variable heights).";

/** The long-document count from the query's value (the default over the
 *  flag's `1` / a malformed value; clamped to the cap). */
function parseLongdocCount(value: string | null): number {
  if (value === null || value === "1") return LONGDOC_DEFAULT_COUNT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return LONGDOC_DEFAULT_COUNT;
  return Math.min(parsed, LONGDOC_MAX_COUNT);
}

/**
 * The long-document seed (`?longdoc=1` / `?longdoc=<n>`): a heading, the
 * intro paragraph, `count` image blocks (the three fixed fixtures cycle —
 * the full-width images stand different heights), and the trailing
 * paragraph. Deterministic ids with one seeder per room (client a seeds,
 * client b joins empty and receives the seed through the room — two
 * deterministic seeders in one room would duplicate the ids in the shared
 * root order). One transact: one undo step, one wire update.
 */
function createLongDoc(seed: boolean, count: number): Doc {
  const doc = createDoc({ id: DOC_ID, createdAt: DOC_CREATED_AT, generateId: deterministicIdGenerator() });
  if (!seed) return doc;
  doc.transact(() => {
    const heading = doc.insertBlock("heading", { level: 1 });
    doc.insertText(heading, 0, "Long document (the windowing baseline)");
    const intro = doc.insertBlock("paragraph");
    doc.insertText(intro, 0, INTRO_PARAGRAPH);
    for (let index = 0; index < count; index += 1) {
      const key = DEMO_IMAGE_KEYS[index % DEMO_IMAGE_KEYS.length] ?? DEMO_IMAGE_KEYS[0];
      doc.insertBlock("image", { src: key });
    }
    const outro = doc.insertBlock("paragraph");
    doc.insertText(outro, 0, "The end of the long document.");
  });
  return doc;
}

export { LONGDOC_DEFAULT_COUNT, createLongDoc, parseLongdocCount };
