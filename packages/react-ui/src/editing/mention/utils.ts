/** The mention trigger's query derivation: the live query over the `@`
 *  phrase (analogous to the slash's derivation). */
import { isQueryBoundary } from "../slash/utils";
import type { MentionDerivation } from "./models";

/**
 * The live query over the `@` phrase: the text between the `@` and the
 * caret / boundary. A closed derivation (the `@` deleted, or the caret out
 * of the window) stands the empty query.
 */
function deriveMention(text: string, atOffset: number, caret: number): MentionDerivation {
  if (atOffset < 0 || atOffset >= text.length || text.charAt(atOffset) !== "@") {
    return { closed: true, query: "", queryEnd: 0 };
  }
  let queryEnd = atOffset + 1;
  while (queryEnd < text.length && !isQueryBoundary(text.charAt(queryEnd))) queryEnd += 1;
  const closed = caret <= atOffset || caret > queryEnd;
  return { closed, query: text.slice(atOffset + 1, queryEnd), queryEnd };
}

export { deriveMention };
