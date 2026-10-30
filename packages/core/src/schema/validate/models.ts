/** The schema validator's types. The constants stand in `constants.ts`.
 */
/** A single schema violation with its location in the document. */
interface ValidationError {
  /**
   * JSON path of the location: `""` (the document), `"v"`,
   * `"blocks.b01.attrs.level"`, `"blocks.b01.content[2].marks.link.href"`.
   */
  path: string;
  /** Description of the violation. */
  message: string;
}

export type { ValidationError };
