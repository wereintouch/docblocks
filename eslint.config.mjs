import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import path from "node:path";
import tseslint from "typescript-eslint";

/**
 * Boundary enforcement:
 *
 * 1. `no-restricted-imports` — bare package specifiers: react-ui must not
 *    import yjs/y-protocols/lib0 or deep `docblocks-core/*` subpaths.
 * 2. `docblocks/no-cross-boundary-import` — resolver-aware check for RELATIVE
 *    imports (string patterns cannot cover arbitrary directory depths):
 *    - packages/react-ui: relative imports must not escape the package dir
 *      (no reaching into packages/core from source);
 *    - packages/core: layers import only downward, schema <- core <- sync.
 */

const boundariesPlugin = {
  rules: {
    "no-cross-boundary-import": {
      meta: {
        type: "problem",
        docs: {
          description: "Forbid relative imports that cross the react-ui package boundary or a core layer boundary",
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

        const inside = (dir, base) => dir === base || dir.startsWith(base + path.sep);

        const check = (node, source) => {
          if (typeof source !== "string" || !source.startsWith(".")) return;
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

          if (inside(file, coreLayerDir) && !inside(resolved, coreLayerDir) && !inside(resolved, schemaDir)) {
            context.report({
              node,
              message: `Relative import "${source}" crosses a core layer boundary (core may only import schema).`,
            });
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

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = tseslint.config(
  {
    ignores: ["**/dist/**", "test-results/**", "playwright-report/**", "coverage/**", ".scratch-editor-spec/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { docblocks: boundariesPlugin },
    rules: {
      "docblocks/no-cross-boundary-import": "error",
    },
  },
  {
    files: ["packages/react-ui/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
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
          ],
        },
      ],
    },
  },
  prettier
);

export default eslintConfig;
