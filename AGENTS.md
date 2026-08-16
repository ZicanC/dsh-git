# Repository Guidelines

## Project Structure & Module Organization

`src/index.ts` is the Host-side Cordis plugin: it owns storage, Session composition, and trusted RPC handlers. Browser React code lives in `src/client/`. Shared graph, protocol, history, and validation modules live under `src/`. Tests are in `tests/`, with builders in `tests/fixtures.ts`. `lib/` is generated package output; never edit it by hand. `cordis.patch.yml` registers the plugin layer, while the two README files document user behavior.

## Build, Test, and Development Commands

- `pnpm install` installs dependencies; development links expect a sibling `../deepseek-harness` checkout.
- `pnpm typecheck` runs strict TypeScript checks without emitting files.
- `pnpm test` runs the Vitest suite once; `pnpm test:watch` supports local iteration.
- `pnpm build` emits declarations and bundles Host and browser entries into `lib/`.
- `pnpm pack` creates the distributable archive for installation testing.
- `pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"` installs this checkout for UI testing.
- `pnpm --dir ../deepseek-harness dsh --profile web --port 0` starts Harness on an available port.

Before submitting, run `pnpm typecheck && pnpm test && pnpm build` and `git diff --check`.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, trailing commas in multiline constructs, and explicit types at public or RPC boundaries. Use `PascalCase` for React components and types, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for protocol constants. Keep Host-only dependencies out of the browser bundle and preserve `.ts`/`.tsx` extensions in relative imports. No formatter or linter is configured, so match nearby code.

## Testing Guidelines

Vitest is the test runner; React behavior uses Testing Library and jsdom. Name tests `*.spec.ts` or `*.spec.tsx` and place them in `tests/`. Add focused regression coverage for graph lineage, storage/RPC validation, composer behavior, and DOM bridge cleanup. There is no configured coverage threshold; behavioral assertions are expected for every change.

## Commit & Pull Request Guidelines

Recent history uses short, imperative subjects such as `Persist graph ledger on host storage`; Conventional Commit prefixes are not required. Add a body for nontrivial changes. Keep commits focused and include regenerated `lib/` output when package behavior changes. Pull requests should explain user-visible behavior, identify Host/client boundaries touched, link issues when applicable, list validation commands, and include screenshots for graph, tray, or other UI changes. Preserve unrelated uncommitted work and never commit profile data, secrets, or new package archives.
