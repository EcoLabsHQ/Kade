# Design handoff — provenance

**Reference only. Never built, imported or executed by the application.**

This is the official Kade MVP design handoff, supplied by the project. It is the
authoritative source for the Week 1 screens.

## What it is

A high-fidelity, clickable design reference: a four-step pre-registration flow,
an eight-screen resident platform, and a two-screen admin console for the
programme operator.

## Contents

| File | What it is |
|---|---|
| `README.md` | The spec: every screen, layout, colours, type, business rules, state model, schema and architecture notes |
| `kade-mvp.dc.html` | The prototype source — template markup followed by a `class Component` logic block holding all seed data and derived values. `renderVals()` is the spec for every number on screen |
| `index.html` | The same prototype bundled as one self-contained offline file |
| `support.js` | The design-tool runtime the prototype needs to run |
| `screenshots/` | 34 PNGs in flow order, plus an index mapping each file to its screen |
| `assets/` | The Onchain Island wordmark |
| `mvp-build-document.docx` | The build guide shipped with the handoff |

## How it is used

It is read, not ported. `apps/web` recreates these designs in Next.js and
Tailwind against the frozen auth model in the Week 1 contract.

Explicit instruction from the handoff:

> Don't port the HTML. `Kade MVP.dc.html` runs on a design-tool runtime, not a
> web framework — it's a reference, not a starting point.

This directory confirms that rule: nothing in the monorepo may import from it.

## Relationship to `reference/mvp-onchainisland/`

`index.html` here has the same SHA-256 as the served bundle at
`https://mvp.onchainisland.co/`, which was extracted separately before this
handoff arrived. Both describe the same design. This handoff is the
**authoritative** version, because it includes the spec and the prototype
source; the earlier extraction remains as a record of what the public
deployment actually served.

## Where the design and the contract disagree

The handoff predates the frozen Week 1 contract, and the contract governs where
they conflict. Known differences, all resolved in favour of the contract:

| Topic | Handoff | Week 1 contract |
|---|---|---|
| Signer | "Privy or the Safe WebAuthn signer" (open decision) | Direct Safe WebAuthn signer, no managed embedded signer |
| Login | "email + passkey, or connect an existing wallet" | Google OAuth only; passkey is transaction-only |
| Chain | Ethereum mainnet as the settlement network | All-testnet iteration 1; Sepolia deploys |
| Provider | "whatever you'd rather use" | Next.js 15 + TypeScript (the handoff suggests 14) |

Schema differences are tracked separately in `docs/architecture/data-model.md`.

## Verification of this copy

| File | SHA-256 (first 16) |
|---|---|
| `README.md` | `190c297f2fdd37de` |
| `kade-mvp.dc.html` | `72fa7e94e63c99ef` |
| `index.html` | `e50597e26db9e19f` |
