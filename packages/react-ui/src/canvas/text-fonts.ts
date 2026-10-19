/**
 * The shape text's font options: the
 * self-hosted set (the package ships the woff2 in fonts/ + the
 * @font-face in the assembled stylesheet's section 5) — each with a
 * Cyrillic-capable fallback in the stack (a file / family missing on
 * the consumer's side degrades to the fallback, not to invisible).
 *
 * The weight coverage per family follows the family's available weights
 * (PT Sans stands 700 over the 600, Lora / PT Serif stand 400 over the
 * 300 — the browser's font matching picks the nearest stand).
 */
export const SHAPE_FONT_OPTIONS = [
  { id: "Inter", label: "Inter", stack: "'Inter', 'Open Sans', Arial, sans-serif" },
  { id: "Open Sans", label: "Open Sans", stack: "'Open Sans', Arial, sans-serif" },
  { id: "PT Sans", label: "PT Sans", stack: "'PT Sans', 'Open Sans', Arial, sans-serif" },
  { id: "Lora", label: "Lora", stack: "'Lora', Georgia, 'Times New Roman', serif" },
  { id: "PT Serif", label: "PT Serif", stack: "'PT Serif', Georgia, 'Times New Roman', serif" },
  { id: "JetBrains Mono", label: "JetBrains Mono", stack: "'JetBrains Mono', 'Courier New', monospace" },
] as const;

/** The name → the stack map (the absent / an unrecognized name falls to
 * the raw name — a consumer's own loaded font is addressable by name). */
export const SHAPE_FONT_STACKS: Record<string, string> = Object.fromEntries(
  SHAPE_FONT_OPTIONS.map((option) => [option.id, option.stack])
);

/** The size field's hints (the field is a numeric input: any value 8–512
 * stands, the list is the datalist's stand). */
export const SHAPE_FONT_SIZE_OPTIONS = [12, 16, 24, 32, 48, 64, 96, 128];

/** The default size (the absent fontSize attr). */
export const SHAPE_TEXT_DEFAULT_SIZE = 16;

/** The weights behind the textStyle's weights (the light / regular /
 * semibold stand). */
export const SHAPE_TEXT_WEIGHTS = { light: 300, regular: 400, semibold: 600 } as const;

/** The textStyle's options (the weight x the slant), the toolbar's menu
 * order. */
export const SHAPE_TEXT_STYLE_OPTIONS = [
  { id: "regular", label: "Regular" },
  { id: "semibold", label: "Semibold" },
  { id: "light", label: "Light" },
  { id: "light-italic", label: "Light Italic" },
  { id: "italic", label: "Italic" },
  { id: "semibold-italic", label: "Semibold Italic" },
] as const;
