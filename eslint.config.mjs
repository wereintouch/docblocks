import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import i18nextPlugin from "eslint-plugin-i18next";
import tailwindCanonicalClasses from "eslint-plugin-tailwind-canonical-classes";
import path from "node:path";
import tseslint from "typescript-eslint";

import {
  PEER_RESTRICTIONS,
  boundariesPlugin,
  peerSubpathRestrictions,
  reactUiBoundaryRestrictions,
  reactUiPeerRestrictions,
} from "./scripts/eslint-boundaries.mjs";

// The design-system components (shared/ui) are Tailwind v4 utility classes
// validated against the tooling-only entry, which mirrors the standard token
// set of the shipped theme.css (same theme a consumer builds from). The
// defaults already pick up `className` attributes and the `cn`/`cva` call
// strings (base + variant values).
const TAILWIND_ENTRY = path.join(import.meta.dirname, "packages", "react-ui", "eslint.tailwind.entry.css");

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = tseslint.config(
  {
    // The scratch / the agent's own context files stand out of the lint (the
    // transient probes are disposable by contract — linting them stands the
    // dev machine's gate red over the scratch, not the code).
    ignores: [
      "**/dist/**",
      "test-results/**",
      "playwright-report/**",
      "coverage/**",
      ".docs/**",
      ".scratch-probes/**",
      ".tmp/**",
      ".pi/**",
      ".playwright-mcp/**",
      "graphify-out/**",
      ".ruff_cache/**",
      ".vitest/**",
      "TODO.md",
      "CLAUDE.md",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { docblocks: boundariesPlugin },
    rules: {
      "docblocks/no-cross-boundary-import": "error",
    },
  },
  // Node scripts (the build scripts, the packaging gate): node globals
  // (console / process / URL / Buffer).
  {
    files: ["**/scripts/**/*.mjs", "test/packaging/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        Buffer: "readonly",
      },
    },
  },

  // The export convention (bottom-block exports): a declaration carries no
  // inline `export` — every module lists its exports in the `export { ... }`
  // / `export type { ... }` block at the bottom. One module surface stands
  // reviewable in one place, and no default export stands in the published
  // code.
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "ExportNamedDeclaration:not([declaration=null])",
          message: "Declarations stand unexported; list them in the export block at the bottom of the file.",
        },
        {
          selector: "ExportDefaultDeclaration",
          message: "No default exports; list the module's exports in the export block at the bottom.",
        },
        {
          selector: "ExportAllDeclaration",
          message: "No star re-exports; list the module's exports in the export block at the bottom.",
        },
      ],
    },
  },

  // The base boundary's stand over the whole react-ui (the subpaths included:
  // the peers' block re-stands the full set over its own files below).
  {
    files: ["packages/react-ui/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", reactUiBoundaryRestrictions],
    },
  },
  // The subpath-scoped peers' scope: the peers' restriction over every
  // react-ui file EXCEPT the subpaths' own source (the mermaid / pdf
  // directories import their peer legitimately — the object's ignores
  // stand the exclusion, the flat config's `files` stands no negation).
  // framer-motion stands unrestricted (the required peer's imports are
  // the Editor's page view + the motion's segment files).
  {
    files: ["packages/react-ui/**/*.{ts,tsx}"],
    ignores: [
      "packages/react-ui/src/mermaid/**",
      "packages/react-ui/src/pdf/**",
      // The package's own test suite stands the peers' stubs / spies
      // (the shipped surface is the src/ only — the tests stand no
      // consumer's import path).
      "packages/react-ui/test/**",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", reactUiPeerRestrictions],
    },
  },
  // The cross-peer's stand per subpath: the subpath's source imports its
  // own peer only (the two foreign peers stay restricted — a cross-peer
  // import would break the consumer without that peer). The blocks stand
  // AFTER the peers' block (the last match wins the rule's options per
  // file) and carry the full set (no merge).
  ...Object.entries(PEER_RESTRICTIONS).map(([subpath]) => ({
    files: [`packages/react-ui/src/${subpath}/**/*.{ts,tsx}`],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", peerSubpathRestrictions(subpath)],
    },
  })),
  // The user-facing strings' guard over the react-ui's source: a literal
  // string in the JSX's text must come from the i18n catalog's `t()`
  // (the "forgotten literal's" stand). The allowlist's stand (the technical
  // strings: the code language's names, the font family's / weight's
  // names, the avatar emoji's accessible names, the technical glyphs)
  // stands the rest as-is.
  {
    files: ["packages/react-ui/src/**/*.{ts,tsx}"],
    plugins: { i18next: i18nextPlugin },
    rules: {
      "i18next/no-literal-string": [
        "warn",
        {
          mode: "jsx-text-only",
          words: {
            exclude: [
              // the technical placeholders (the color input's hex, the empty's stand)
              "#rrggbb",
              // the code language's names (the technical stand — not translated; the
              // entries stand the full-match regexes — the metachars escaped)
              "Bash",
              "C",
              "C#",
              "C\\+\\+",
              "CSS",
              "Go",
              "Java",
              "JavaScript",
              "JSON",
              "Kotlin",
              "Markdown",
              "Mermaid",
              "PHP",
              "Plain Text",
              "Python",
              "Rust",
              "SQL",
              "Swift",
              "TOML",
              "TypeScript",
              "XML / HTML",
              // the font family's names + the weight/style's labels (the technical stand)
              "Inter",
              "PT Sans",
              "PT Serif",
              "JetBrains Mono",
              "Regular",
              "Bold",
              "Semibold",
              "Italic",
              "Semibold Italic",
              // the avatar emoji catalog's accessible names (the emoji's proper nouns —
              // the v1's stand, the e2e's pin)
              "Fox",
              "Cat",
              "Dog",
              "Panda",
              "Unicorn",
              "Frog",
              "Owl",
              "Turtle",
              "Bee",
              "Butterfly",
              "Sun",
              "Moon",
              "Star",
              "Sparkles",
              "Rainbow",
              "Fire",
              "Gem",
              "Bolt",
              "Red heart",
              "Blue heart",
              "Green heart",
              "Yellow heart",
              "Pencil",
              "Books",
              "Target",
              "Rocket",
              "Palette",
              "Coffee",
              "Clover",
              "Trophy",
              // the technical glyphs (the zoom's percent, the time segments'
              // colon, the required mark's asterisk, the clear's / the "any's"
              // dash, the boolean's stand)
              "%",
              ":",
              "\\*",
              "×",
              "—",
              "true",
              "false",
            ],
          },
        },
      ],
    },
  },
  // Tailwind class hygiene for react-ui: order + line wrapping (auto-fixable),
  // canonical forms, and correctness (typos / conflicting classes).
  {
    files: ["packages/react-ui/**/*.{ts,tsx}"],
    plugins: {
      "better-tailwindcss": betterTailwindcss,
      "tailwind-canonical-classes": tailwindCanonicalClasses,
    },
    settings: {
      "better-tailwindcss": { entryPoint: TAILWIND_ENTRY },
    },
    rules: {
      "better-tailwindcss/enforce-consistent-class-order": "warn",
      "better-tailwindcss/enforce-consistent-line-wrapping": [
        "warn",
        { printWidth: 120, group: "newLine", preferSingleLine: true, strictness: "loose", indent: 2 },
      ],
      "better-tailwindcss/no-unknown-classes": "error",
      "better-tailwindcss/no-conflicting-classes": "error",
      "tailwind-canonical-classes/tailwind-canonical-classes": ["warn", { cssPath: TAILWIND_ENTRY }],
    },
  },
  prettier
);

export default eslintConfig;
