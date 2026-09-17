# ADR 0002 — Web framework and design system

**Status:** accepted · 17 September 2026
**Refs:** week-1 contract sections 4 (D3, D5) and 6.1; DOCX section 8 (Frontend)

## Context

The frozen contract requires the Week 1 screens to match the deployed MVP at
`https://mvp.onchainisland.co/`. Contract section 6.1 records that the MVP UI
**source repository is not available**, which escalated the frontend effort: the
shell and Steps 1–2 must be recreated rather than wired up.

The deployed MVP is published as a self-contained bundle document, so its
markup and component logic can be recovered from the deployment itself. That
recovered material is vendored under `reference/mvp-onchainisland/`.

## Decision

- **Next.js 15 with the App Router.** React Server Components let the shell
  render without blocking on a chain read, which the build guide names as a
  hard rule ("never block a render on a chain read").
- **TypeScript strict**, with `noUncheckedIndexedAccess`.
- **Tailwind CSS v4** for layout, plus CSS custom properties for the design
  tokens. Exact values that Tailwind expresses poorly (the reference uses
  inline styles throughout) stay as inline styles on the primitive components.
- **Design tokens are lifted verbatim from the reference**, so the recreation is
  a port rather than an interpretation:

  | Token | Value |
  |---|---|
  | Brand primary | `#0063B5` |
  | Action / accent | `#0A7CFF` |
  | Ink | `#101828` |
  | Muted ink | `#667085` |
  | Surface | `#FAFAFA` |
  | Border | `#EAEDF1` |
  | Active nav background | `#EAF2FC` |
  | Success / warning / danger | `#1B7F5A` / `#B7791F` / `#B42318` |
  | Locked | `#98A2B3` |
  | Sidebar width | `240px` |
  | Content column | `1160px` |
  | Font | Plus Jakarta Sans |

- **The reference is never imported.** It is documentation of the baseline. The
  `x-dc` / `sc-if` / `{{ }}` dialect is not React and is not used at runtime.

## Consequences

- Visual parity is reviewable against the reference file rather than from
  memory.
- The reference must be updated only by re-extracting from the deployment, not
  by editing (its hashes are recorded in `PROVENANCE.json`).
- A reviewer can diff ported token values against the reference mechanically.
- Recreation effort is real and was flagged under contract section 6.1; this ADR
  does not claim that effort away.

## Alternatives considered

- **Reusing the `x-dc` document directly** — it is a bespoke document-component
  format with no build, no types and no test story; it would fail every gate in
  the development contract.
- **Framework-free HTML** — loses server rendering, routing and type safety.
- **Copying only screenshots** — loses exact spacing, weights and states, which
  is precisely what "match the deployed baseline" requires.
