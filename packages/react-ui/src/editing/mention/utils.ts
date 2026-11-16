/** The mention trigger's query derivation: the live query over the `@`
 *  phrase (analogous to the slash's derivation). */
import type { MentionDerivation } from "./models";

/**
 * The live query over the `@` phrase: the text between the `@` and the
 * caret — the space is part of the query (the whole phrase is searched,
 * `@my doc` stands the `my doc` query). A closed derivation (the `@`
 * deleted, or the caret at / before the `@`) stands the empty query; the
 * input's interruption is the Escape's close only (the phrase then stands
 * the plain text).
 */
function deriveMention(text: string, atOffset: number, caret: number): MentionDerivation {
  if (atOffset < 0 || atOffset >= text.length || text.charAt(atOffset) !== "@") {
    return { closed: true, query: "", queryEnd: 0 };
  }
  const queryEnd = Math.min(caret, text.length);
  if (caret <= atOffset) return { closed: true, query: "", queryEnd: 0 };
  return { closed: false, query: text.slice(atOffset + 1, queryEnd), queryEnd };
}

export { deriveMention };
