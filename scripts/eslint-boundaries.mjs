/**
 * The ESLint boundary layer: the custom resolver-aware import rule, the
 * import-restriction sets (the react-ui public-API contract + the
 * subpath-scoped peers), and the export convention's rule options. The
 * root `eslint.config.mjs` composes them into the flat config.
 */
import path from "node:path";

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
        const root = context.cwd ?? path.resolve(import.meta.dirname, "..");
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

// The boundary plugin + the restriction sets stand the config's data; the
// flat config's blocks below compose them.
export {
  boundariesPlugin,
  PEER_RESTRICTIONS,
  reactUiBoundaryRestrictions,
  reactUiPeerRestrictions,
  peerSubpathRestrictions,
};
