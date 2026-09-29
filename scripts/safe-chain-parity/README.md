# Safe address chain-parity proof (opt-in)

This directory holds the **opt-in, network-dependent** proof that the resident
Safe address is the same on Ethereum mainnet (chain `1`) and Sepolia (chain
`11155111`), derived through the real Safe SDK against real RPC endpoints.

It is intentionally **not** run by `./scripts/verify.sh`. The canonical gate is
offline and must stay green without network access; this proof makes real RPC
round-trips and needs endpoint credentials.

## Run it

```bash
scripts/safe-chain-parity/run.sh
```

The script:

1. changes into `apps/web/`;
2. loads `apps/web/.env.local` when present (so `ETHEREUM_RPC_URL` and
   `SEPOLIA_RPC_URL` come from the app's own local config);
3. refuses with a loud message if either RPC variable is missing;
4. runs the proof through `vitest.config.ts` in this directory.

To run without a `.env.local`, export the two variables first and invoke the
script (or `npx vitest run --config scripts/safe-chain-parity/vitest.config.ts`).

## What it asserts

`apps/web/tests/proofs/safe-address-chain-parity.proof.ts` initialises the
app's own create-Safe path, `initSafe4337Pack` (the same code the product uses),
with a fixed synthetic passkey on both chains, reads the predicted Safe address
from the SDK, and asserts the two are byte-for-byte equal. It fails loudly,
naming both addresses, if they differ.

The proof derives the address with `bundlerUrl` set to the chain's RPC endpoint:
address prediction makes no bundler request, and the RPC answers the one
relay-kit call made during init (`eth_chainId`). The prediction itself uses the
real provider for the on-chain reads the SDK performs.

## Why it is separate from the unit tests

`apps/web/tests/safe-4337-singleton-pin.test.ts` pins the two chain-dependent
address inputs (the salt and the singleton) with both Safe SDKs mocked. That is
fast, deterministic and offline, but it cannot show that the real SDK agrees
across chains. This proof closes that gap; the unit suite remains the offline
gate.

The `*.proof.ts` extension keeps this file out of the app's default
`tests/**/*.test.{ts,tsx}` collection, so `npm run test` (and therefore
`./scripts/verify.sh`) never runs it.
