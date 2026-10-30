# Local task runner for the docblocks monorepo.
# Targets wrap the npm scripts (see package.json); `make help` lists them all.

.DEFAULT_GOAL := help

CORE := -w packages/core
UI := -w packages/react-ui
PG := -w apps/playground

.PHONY: help lint lint-fix format format-check typecheck typecheck-core typecheck-ui typecheck-playground deprecations build build-core test test-core test-ui unit unit-f e2e e2e-file dev-gate check full dev clean

help: ## Show this help (default target)
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

## Quality gates

lint: ## ESLint, whole repo (includes the boundary gates)
	npm run lint

lint-fix: ## ESLint with autofix
	npm run lint:fix

format: ## Prettier: write formatting for all files
	npm run format

format-check: ## Prettier: check only (fails on unformatted files)
	npm run format:check

typecheck: ## tsc --noEmit in every workspace (core, react-ui, playground)
	npm run typecheck

typecheck-core: ## tsc --noEmit: docblocks-core
	npm run typecheck $(CORE)

typecheck-ui: ## tsc --noEmit: docblocks-react-ui (resolves core from dist: run `make build` first on a fresh clone)
	npm run typecheck $(UI)

typecheck-playground: ## tsc --noEmit: playground app
	npm run typecheck $(PG)

deprecations: ## Deprecated API usage over the typecheck's tsconfigs (fails; inline deprecation-allow markers)
	npm run check:deprecations

## Build and tests

build: ## Build dist for both packages (core first)
	npm run build

build-core: ## Build dist for docblocks-core
	npm run build $(CORE)

test: ## Unit tests (vitest, all workspaces; sibling packages resolve from dist)
	npm test

test-core: ## Unit tests: docblocks-core
	npm test $(CORE)

test-ui: ## Unit tests: docblocks-react-ui
	npm test $(UI)

unit: ## All unit tests (vitest, ~10s wall) — the e2e stands separate (make e2e / e2e-file)
	npm test

e2e: ## Playwright E2E (playground consumes react-ui from dist — make build first)
	npm run test:e2e

e2e-file: ## E2E a single spec (make e2e-file F=test/e2e/canvas-connectors.spec.ts)
	@test -n "$(F)" || { echo "usage: make e2e-file F=<spec path>"; exit 1; }
	npm run test:e2e -- $(F)

unit-f: ## Unit tests: a single file (make unit-f F=packages/react-ui/test/canvas.test.tsx)
	@test -n "$(F)" || { echo "usage: make unit-f F=<test file>"; exit 1; }
	case "$(F)" in \
		packages/core/*) REL=${F#packages/core/}; npm test -w packages/core -- "$(REL)";; \
		packages/react-ui/*) REL=${F#packages/react-ui/}; npm test -w packages/react-ui -- "$(REL)";; \
		*) echo "F must be under packages/core or packages/react-ui"; exit 1;; \
	esac

dev-gate: ## Daily dev loop (~20s): lint + typecheck + unit tests
	npm run lint && npm run typecheck && npm test

## Gates

check: lint typecheck deprecations ## Quick gate: lint + typecheck + deprecations

full: ## Full local gate: lint -> format -> build -> typecheck -> test -> e2e
	npm run check

## Dev and cleanup

dev: ## Playground dev server (Vite; consumes react-ui from dist — make build first)
	npm run dev $(PG)

clean: ## Remove build artifacts (dist, test reports)
	rm -rf packages/core/dist packages/react-ui/dist test-results playwright-report
