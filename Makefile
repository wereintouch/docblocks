# Local task runner for the docblocks monorepo.
# Targets wrap the npm scripts (see package.json); `make help` lists them all.

.DEFAULT_GOAL := help

CORE := -w packages/core
UI := -w packages/react-ui
PG := -w apps/playground

.PHONY: help lint lint-fix format format-check typecheck typecheck-core typecheck-ui typecheck-playground build build-core test test-core test-ui e2e check full dev clean

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

e2e: ## Playwright E2E (playground consumes react-ui from dist — make build first)
	npm run test:e2e

## Gates

check: lint typecheck ## Quick gate: lint + typecheck

full: ## Full local gate: lint -> format -> build -> typecheck -> test -> e2e
	npm run check

## Dev and cleanup

dev: ## Playground dev server (Vite; consumes react-ui from dist — make build first)
	npm run dev $(PG)

clean: ## Remove build artifacts (dist, test reports)
	rm -rf packages/core/dist packages/react-ui/dist test-results playwright-report
