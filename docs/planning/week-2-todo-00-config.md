# Week 2 — Front 00 (mainnet-config, EXE-010) — todo and status

**Branch:** `week-2-00-mainnet-config`
**Package:** EXE-010 — Ethereum mainnet activation and Week 2 configuration
**Scope source:** `docs/week-2-frozen-delivery-contract.md` (Frozen v1.0) §2.2,
§3, §5; brief in `docs/planning/week-2-front-briefs.md`.

## Delivered

- **Environment keys** (`apps/web/src/lib/env.ts`, `.env.example`):
  - `ETHEREUM_RPC_URL` → `readEthereumRpcUrl()` (server-only, not
    `NEXT_PUBLIC_`).
  - `MAINNET_TREASURY_ADDRESS` → `readMainnetTreasuryAddress()` (server-only,
    validated as a 20-byte hex address).
  - Chain-aware readers `readTreasuryAddressFor(env)` / `readRpcUrlFor(env)`.
  - Existing `TREASURY_ADDRESS` / `SEPOLIA_RPC_URL` / `KADE_CHAIN_ENV`
    behaviour is unchanged.
- **Shared config** (`packages/shared/src/config.ts`, exported from
  `packages/shared/src/index.ts`):
  - `CHAIN_ENVIRONMENTS`, `DEFAULT_CHAIN_ENV` (`testnet`).
  - `CHAIN_ENV_CONFIG` with the settlement chain and the server-only variable
    names for each environment, and `chainEnvironmentConfig(env)`.
  - No address or URL is stored: the variable *names* only.
- **Server-side treasury read** (`apps/web/src/lib/config/mainnet.ts`):
  - `readMainnetConfig()` / `isMainnetConfigured()`, guarded so a missing or
    malformed treasury or RPC returns `null` and disables the mainnet path.
  - The token and chain id come from the frozen `@kade/shared` registry.
- **Chains seed**: the Ethereum-mainnet `chains` row already existed from
  Week 1 (chain id 1, Circle USDC, `env = mainnet`); the generated
  `supabase/seed.sql` is unchanged and its drift guard still passes. The frozen
  `fee_schedule` rows are untouched.
- **Tests**: `packages/shared/tests/config.test.ts`,
  `apps/web/tests/env-mainnet.test.ts`,
  `apps/web/tests/mainnet-config.test.ts`, plus mainnet registry cases in
  `packages/shared/tests/chains.test.ts`.

## BLOCKED: mainnet funding/treasury not supplied

No Ethereum mainnet RPC URL, deployment payer or treasury address was supplied
by the project (week-2 contract §5; freeze checklist "mainnet funding, treasury
and Morpho pool supplied — pending availability"). No value was invented.

Consequences:

- The mainnet path is wired but **inactive**: `readMainnetConfig()` returns
  `null` until `ETHEREUM_RPC_URL` and `MAINNET_TREASURY_ADDRESS` are supplied in
  the deployment environment.
- No mainnet transaction was built, signed, simulated or broadcast.
- Activating mainnet remains gated on the Foundation checkpoint (contract §7)
  receiving the real values.

## Notes (not owned by this front)

- `MAINNET_CHAINS` still marks Base mainnet `active: true` from the Week 1
  reservation, while week-2 contract §2.2 item 1 says Arbitrum and Base remain
  deferred. Changing that flag is a chain-set decision, which Appendix C1
  reserves to the human owner, so it was left as-is and is flagged here.
- The mainnet Ethereum EAS address and schema registry remain `[arbitrary]`
  placeholders from Week 1. The config agent must not invent them
  (Appendix C1), so they were left unchanged.
