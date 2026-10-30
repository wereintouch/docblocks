/**
 * The code block's syntax highlight service (the background layer's
 * color source).
 *
 * highlight.js is used for COLORING ONLY: the service turns the block's
 * source text into an HTML fragment of `hljs-*` token spans. The service
 * renders nothing — the fragment is for the block renderer to draw as
 * the highlight layer behind the inner editable, and it is a
 * view-layer-only projection of the (text, language) pair: the document
 * data, the editable DOM, and the diff/selection/clipboard pipelines
 * never see it, so it adds no wire traffic and no undo step.
 *
 * Only the highlight.js core is a base dependency; the language
 * grammars load lazily (a static-list dynamic import on the first block
 * of the language, promise-cached) so a consumer ships the languages its
 * documents actually use.
 */
import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";

/**
 * The curated code-block language values mapped to their highlight.js
 * grammar ids. An absent (""), unknown, or `mermaid` language renders
 * plain (no layer — no auto-detect). `toml` maps to the `ini` grammar
 * (highlight.js ships no dedicated toml grammar; ini covers the
 * table/key=value shapes).
 */
const HIGHLIGHT_GRAMMARS: Readonly<Record<string, string>> = {
  bash: "bash",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  css: "css",
  go: "go",
  java: "java",
  javascript: "javascript",
  json: "json",
  kotlin: "kotlin",
  markdown: "markdown",
  php: "php",
  python: "python",
  rust: "rust",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  typescript: "typescript",
  xml: "xml",
  yaml: "yaml",
};

/**
 * One static import per grammar (a literal specifier — the bundler
 * splits them into per-language chunks instead of inlining the whole
 * grammar set), keyed by grammar id.
 */
const GRAMMAR_LOADERS: Readonly<Record<string, () => Promise<{ default: LanguageFn }>>> = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  go: () => import("highlight.js/lib/languages/go"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  php: () => import("highlight.js/lib/languages/php"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

/** The in-flight / settled grammar loads, keyed by grammar id. */
const loadedGrammars = new Map<string, Promise<void>>();

/**
 * Load and register one grammar. The load runs once per grammar — the
 * promise is cached, so concurrent first blocks of a language share a
 * single load. A failed load is evicted from the cache and re-thrown
 * (a transient chunk fetch failure stays retryable); `highlightCode`
 * degrades a failed load to plain text (it never rejects on its own).
 */
function loadGrammar(grammar: string): Promise<void> {
  const pending = loadedGrammars.get(grammar);
  if (pending !== undefined) return pending;
  const loader = GRAMMAR_LOADERS[grammar];
  // unreachable via highlightCode (grammarOf only returns the map's
  // ids); a direct call with an unknown id degrades to plain text
  // (the unknown-language throw is caught in highlightCode)
  if (loader === undefined) return Promise.resolve();
  const load = (async (): Promise<void> => {
    try {
      const module = await loader();
      hljs.registerLanguage(grammar, module.default);
    } catch (error) {
      // a failed load is evicted from the cache and re-thrown (retryable)
      loadedGrammars.delete(grammar);
      throw error;
    }
  })();
  loadedGrammars.set(grammar, load);
  return load;
}

/** The highlight grammar id of a block language, or null (plain text). */
function grammarOf(language: string | undefined): string | null {
  if (language === undefined || language === "") return null;
  return HIGHLIGHT_GRAMMARS[language] ?? null;
}

/** Whether the language carries a highlight (the curated set). */
function isHighlightable(language: string | undefined): boolean {
  return grammarOf(language) !== null;
}

/** Whether the grammar is registered (a settled load). */
function isGrammarLoaded(grammar: string): boolean {
  return hljs.getLanguage(grammar) !== undefined;
}

/**
 * Turn the code text into the overlay's HTML fragment synchronously (the
 * grammar must be loaded — see `loadGrammar`). Returns null when the
 * language has no highlight, the grammar is not loaded, a grammar edge
 * case throws, or the output fails the structure guard.
 */
function highlightSync(code: string, language: string | undefined): string | null {
  const grammar = grammarOf(language);
  if (grammar === null || isGrammarLoaded(grammar) === false) return null;
  let value: string;
  try {
    value = hljs.highlight(code, { language: grammar, ignoreIllegals: true }).value;
  } catch {
    // a grammar edge case must never take the block down: plain text
    return null;
  }
  return guardOutput(value) ? value : null;
}

/**
 * Turn the code text into the overlay's HTML fragment (async: the grammar
 * load included). Resolves to null (never rejects) when the language has
 * no highlight (plain text), when the grammar load fails, when a grammar
 * edge case throws, or when the output fails the structure guard — the
 * caller then renders no layer.
 */
async function highlightCode(code: string, language: string | undefined): Promise<string | null> {
  const grammar = grammarOf(language);
  if (grammar === null) return null;
  try {
    await loadGrammar(grammar);
  } catch {
    // a failed load degrades to the missing-grammar null below
  }
  return highlightSync(code, language);
}

/**
 * The output structure guard: highlight.js emits only `hljs-*`-classed
 * spans and escaped text (never a foreign element or attribute). A
 * violation means a compromised or broken grammar output — drop the
 * layer instead of inserting it.
 */
function guardOutput(html: string): boolean {
  return !/<(?!\/?span[\s>])/u.test(html);
}

export { grammarOf, highlightCode, highlightSync, isGrammarLoaded, isHighlightable, loadGrammar };
