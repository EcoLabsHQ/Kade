# ADR 0001 — Monorepo and toolchain

**Status:** accepted · 17 September 2026
**Refs:** week-1 contract section 3 (EXE-001), DOCX section 2 (submission package)

## Context

Week 1 needs a monorepo holding a Next.js application, Solidity
contracts, database migrations and shared types. The portal checklist expects
`apps/web`, `packages/contracts` and `supabase/` to exist as visible parts of
one repository.

The repository's own contract requires a single canonical verification command,
`./scripts/verify.sh`, runnable by humans, agents, CI and `git bisect run`.

## Decision

One npm-workspaces monorepo with three workspaces:

```text
apps/web             @kade/web
packages/shared      @kade/shared
packages/contracts   @kade/contracts
```

- **Package manager: npm workspaces.** pnpm is not installed in the build
  environment and npm is the common denominator for CI and hosting. The lock
  file is committed so installs are reproducible.
- **Shared code lives in `@kade/shared`** and is consumed as TypeScript source
  rather than a build artefact, so a type change is a compile error rather than
  a stale dependency.
- **One verification entry point.** `scripts/verify.sh` runs typecheck, lint,
  unit tests, regression tests and build for the JS side, plus `forge build`
  and `forge test` when `foundry.toml` is present. Expensive or
  environment-dependent checks live in `scripts/verify-full.sh`.

## Consequences

- A single `npm install` at the root installs every workspace.
- `npm run <script> --workspaces --if-present` lets packages opt into gates
  without making the root script aware of each one.
- Foundry is invoked through the shell rather than npm, because it is a
  purpose-built toolchain and wrapping it adds nothing.
- Adding a fourth chain later is a configuration change, not a new package.

## Alternatives considered

- **pnpm workspaces** — better disk efficiency, not installed here; adds a
  global toolchain prerequisite to a repository judges must be able to build.
- **Separate repositories** — contradicts the portal checklist's expectation of
  one monorepo and makes atomic cross-cutting commits impossible.
- **Turborepo/Nx** — real value only once build caching matters; unnecessary
  scope for a 20-hour week.
