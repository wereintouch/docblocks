import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import i18nextPlugin from "eslint-plugin-i18next";
import tailwindCanonicalClasses from "eslint-plugin-tailwind-canonical-classes";
import path from "node:path";
import tseslint from "typescript-eslint";

/**
 * Boundary enforcement:
 *
 * 1. `no-restricted-imports` — bare package specifiers: react-ui must not
 *    import yjs/y-protocols/lib0 or deep `docblocks-core/*` subpaths; the
 *    subpath-scoped peers (mermaid / pdfjs-dist) stand over their own
 *    subpath's source only (`./mermaid` / `./pdf`). framer-motion is a
 *    required peer (the Editor's page view is the motion row layer) and
 *    stands unrestricted.
 * 2. `docblocks/no-cross-boundary-import` — resolver-aware check:
 *    - packages/react-ui: relative imports must not escape the package dir
 *      (no reaching into packages/core from source);
 *    - packages/core: layers import only downward, schema <- core <- sync;
 *    - cross-layer imports use the layer's public interface via the
 *      `@docblocks-core/<layer>` alias — relative "../schema" imports are
 *      rejected (the alias maps to the layer barrel, see packages/core/tsconfig.json);
 *    - layer aliases are downward-only (no sideways/upward).
 */

const boundariesPlugin = {
  rules: {
    "no-cross-boundary-import": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Forbid relative imports crossing package/layer boundaries, and upward/sideways/unknown @docblocks-core/* layer-alias imports",
        },
        schema: [],
      },
      create(context) {
        const root = context.cwd ?? import.meta.dirname;
        const file = context.filename ?? context.getFilename();
        const fileDir = path.dirname(file);

        const reactUiDir = path.join(root, "packages", "react-ui");
        const coreSrcDir = path.join(root, "packages", "core", "src");
        const schemaDir = path.join(coreSrcDir, "schema");
        const coreLayerDir = path.join(coreSrcDir, "core");
        const syncLayerDir = path.join(coreSrcDir, "sync");

        const inside = (dir, base) => dir === base || dir.startsWith(base + path.sep);

        // Layer order (bottom -> top); a layer may only import lower layers.
        const layerIndex = { schema: 0, core: 1, sync: 2 };
        const layerOf = (dir) =>
          inside(dir, schemaDir)
            ? "schema"
            : inside(dir, coreLayerDir)
              ? "core"
              : inside(dir, syncLayerDir)
                ? "sync"
                : null;
        const LAYER_ALIAS = { schema: "@docblocks-core/schema", core: "@docblocks-core/core" };

        const check = (node, source) => {
          if (typeof source !== "string") return;

          // Layer aliases: resolve to layer barrels; only downward allowed.
          if (source.startsWith("@docblocks-core/")) {
            const rest = source.slice("@docblocks-core/".length);
            const target = rest.split("/")[0];
            const fileLayer = layerOf(fileDir);
            if (!(target in LAYER_ALIAS)) {
              context.report({
                node,
                message: `Unknown layer alias "${source}" — allowed: "${LAYER_ALIAS.schema}", "${LAYER_ALIAS.core}".`,
              });
            } else if (rest.length > target.length) {
              context.report({
                node,
                message: `Deep layer alias "${source}" is not allowed — import the layer's public interface (the barrel), not a file inside it.`,
              });
            } else if (fileLayer && layerIndex[target] >= layerIndex[fileLayer]) {
              context.report({
                node,
                message: `Alias import "${source}" is not a lower layer than "${fileLayer}" — a layer may only import lower layers.`,
              });
            }
            return;
          }

          if (!source.startsWith(".")) return;
          const resolved = path.resolve(fileDir, source);
          const intoNodeModules = resolved.split(path.sep).includes("node_modules");
          if (intoNodeModules) return;

          if (inside(file, reactUiDir) && !inside(resolved, reactUiDir)) {
            context.report({
              node,
              message:
                `Relative import "${source}" escapes packages/react-ui. ` +
                "Build strictly on the public API of docblocks-core (bare package import).",
            });
            return;
          }

          if (inside(file, schemaDir) && !inside(resolved, schemaDir)) {
            context.report({
              node,
              message: `Relative import "${source}" crosses the schema layer boundary (schema must not import core/sync).`,
            });
            return;
          }

          if (inside(file, coreLayerDir) && !inside(resolved, coreLayerDir)) {
            if (inside(resolved, schemaDir)) {
              context.report({
                node,
                message:
                  `Relative import "${source}" crosses the core -> schema layer boundary. ` +
                  `Import the layer's public interface via the "${LAYER_ALIAS.schema}" alias.`,
              });
            } else {
              context.report({
                node,
                message: `Relative import "${source}" crosses a core layer boundary (core may only import schema).`,
              });
            }
            return;
          }

          if (inside(file, syncLayerDir) && !inside(resolved, syncLayerDir)) {
            if (inside(resolved, coreLayerDir) || inside(resolved, schemaDir)) {
              const alias = inside(resolved, coreLayerDir) ? LAYER_ALIAS.core : LAYER_ALIAS.schema;
              context.report({
                node,
                message:
                  `Relative import "${source}" crosses a sync layer boundary. ` +
                  `Import the layer's public interface via the "${alias}" alias.`,
              });
            } else {
              context.report({
                node,
                message: `Relative import "${source}" crosses a sync layer boundary (sync may only import core and schema).`,
              });
            }
          }
        };

        return {
          ImportDeclaration(node) {
            check(node, node.source.value);
          },
          ImportExpression(node) {
            const source = node.source.value;
            check(node, source);
          },
          ExportAllDeclaration(node) {
            if (node.source) check(node, node.source.value);
          },
          ExportNamedDeclaration(node) {
            if (node.source) check(node, node.source.value);
          },
        };
      },
    },
  },
};

// The design-system components (shared/ui) are Tailwind v4 utility classes
// validated against the tooling-only entry, which mirrors the standard token
// set of the shipped theme.css (same theme a consumer builds from). The
// defaults already pick up `className` attributes and the `cn`/`cva` call
// strings (base + variant values).
const TAILWIND_ENTRY = path.join(import.meta.dirname, "packages", "react-ui", "eslint.tailwind.entry.css");

/**
 * The react-ui boundary's import restrictions (the public-API-only
 * contract): the yjs stack, the core's deep subpaths and layer aliases.
 * Stood as a const so the optional-peers' block (below) reuses the same
 * set — the flat config's later block stands the rule's full options (the
 * per-file merge is a replace, not a union), so the reuse keeps the yjs'
 * stand over the non-peer's files too.
 */
const reactUiBoundaryRestrictions = {
  paths: ["yjs", "y-protocols", "lib0"],
  patterns: [
    {
      regex: "^yjs(/.*)?$",
      message: "react-ui must not import yjs — build strictly on the docblocks-core public API.",
    },
    {
      regex: "^y-protocols(/.*)?$",
      message: "react-ui must not import y-protocols — build strictly on the docblocks-core public API.",
    },
    {
      regex: "^lib0(/.*)?$",
      message: "react-ui must not import lib0 — build strictly on the docblocks-core public API.",
    },
    {
      regex: "^docblocks-core/.+",
      message: "react-ui must import only the docblocks-core public entry — deep subpaths are internal.",
    },
    {
      regex: "^@docblocks-core(/.*)?$",
      message:
        "react-ui must import only the docblocks-core public entry — layer aliases are internal to the core package.",
    },
  ],
};

/**
 * The subpath-scoped peers' file scope (the package's peer contract): the
 * mermaid / pdfjs-dist imports stand over their own subpath's source only
 * (the `./mermaid` / `./pdf` exports — the subpath's bundle carries its
 * peer only). framer-motion is a required peer (the Editor's page view is
 * the motion row layer) and stands unrestricted. The block stands the FULL
 * restrictions (the boundary's set + the peers) over every other react-ui
 * file: the flat config's later block replaces the rule's options per
 * file (no merge), so the base block's yjs' stand would not reach the
 * non-peer's files otherwise.
 */
const reactUiPeerRestrictions = {
  ...reactUiBoundaryRestrictions,
  paths: [...reactUiBoundaryRestrictions.paths, "mermaid", "pdfjs-dist"],
  patterns: [
    ...reactUiBoundaryRestrictions.patterns,
    {
      regex: "^mermaid(/.*)?$",
      message: "mermaid stands over the ./mermaid subpath's source only (the subpath's peer).",
    },
    {
      regex: "^pdfjs-dist(/.*)?$",
      message: "pdfjs-dist stands over the ./pdf subpath's source only (the subpath's peer).",
    },
  ],
};

/**
 * The per-subpath peer's scope (the cross-peer's stand): a subpath's source
 * imports ITS peer only — the other peer stays restricted (a cross-peer
 * import would pull the foreign dependency into the subpath's bundle and
 * break the consumer's bundle boundary). Each block stands the FULL
 * restrictions (the flat config's later block replaces the rule's options
 * per file, no merge): the boundary's set + the foreign peer.
 */
const PEER_RESTRICTIONS = {
  mermaid: { peer: "mermaid", foreign: ["pdfjs-dist"], message: "the ./mermaid subpath" },
  pdf: { peer: "pdfjs-dist", foreign: ["mermaid"], message: "the ./pdf subpath" },
};

const peerSubpathRestrictions = (subpath) => {
  const { foreign, message } = PEER_RESTRICTIONS[subpath];
  return {
    ...reactUiBoundaryRestrictions,
    paths: [...reactUiBoundaryRestrictions.paths, ...foreign],
    patterns: [
      ...reactUiBoundaryRestrictions.patterns,
      ...foreign.map((peer) => ({
        regex: `^${peer}(/.*)?$`,
        message: `${peer} stands over its own subpath's source only — ${message} imports its peer only (the consumer's opt-in per dependency).`,
      })),
    ],
  };
};

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
