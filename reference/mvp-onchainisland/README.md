# Reference: deployed Kade MVP UI (`mvp.onchainisland.co`)

**Reference only. This directory is never built, bundled, imported or executed.**

It exists so the recreated Week 1 screens can match the deployed visual and
interaction baseline required by
`docs/week-1-frozen-delivery-contract.md` §4 (D3, D5).

## Provenance

The deployed MVP at `https://mvp.onchainisland.co/` is published as a
self-contained bundle document. The application markup and component logic are
embedded in the served HTML rather than fetched from a source repository, which
is why the frozen contract (§6.1) records the MVP UI source as "not available".

The files here were extracted from the served bundle at the URL and timestamp
recorded in `PROVENANCE.json`. No source repository was accessed, because none
is published.

## Contents

| File | What it is |
|---|---|
| `template.html` | The `x-dc` document: page shell, sidebar, and all screens. |
| `component-logic.js` | The `class Component extends DCLogic` block: state and derived view values. |
| `onchain-island-logo.png` | The Onchain Island wordmark used in the sidebar. |

## What this is not

- Not a runnable application. The `x-dc` / `sc-if` / `sc-for` / `{{ }}` dialect is
  a document-component format, not React, and is not used by `apps/web`.
- Not third-party code. This is the Kade / Onchain Island design prototype
  described in the prior-work disclosure in the root `README.md`.
- Not a dependency. Nothing in the monorepo may import from this directory.

## How it is used

`apps/web` recreates the shell and the Week 1 screens in Next.js and Tailwind.
The reference fixes the design tokens and layout:

| Token | Value |
|---|---|
| Brand primary | `#0063B5` |
| Action / accent | `#0A7CFF` |
| Ink | `#101828` |
| Muted ink | `#667085` |
| Surface | `#FAFAFA` |
| Border | `#EAEDF1` |
| Active nav background | `#EAF2FC` |
| Success | `#1B7F5A` |
| Warning | `#B7791F` |
| Danger | `#B42318` |
| Locked | `#98A2B3` |
| Sidebar width | `240px` |
| Content column | `1160px` |
| Font | Plus Jakarta Sans |

## Licence and attribution

The design prototype is Kade / Onchain Island prior work. The bundled
`react`, `react-dom` and `dc-runtime` scripts that accompanied it are
third-party and are deliberately **not** vendored here.
