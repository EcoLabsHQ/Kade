# Week 2 front 01 — signer-deploy (EXE-011)

**Branch:** `week-2-01-signer-deploy`
**Subject:** `docs/known-gaps.md` — "Safe WebAuthn signer contract — Not deployed".

## Status

The direct Safe WebAuthn signer is **not deployed**, and this front must not
deploy it: the deployment is an irreversible on-chain write and the Week 2
Account gate is not approved.

What is delivered is the call path up to the deployment:

- `apps/web/src/lib/safe/signer.ts` — `preparePasskeySigner` builds the
  `SafeWebAuthnSignerFactory.createSigner(uint256,uint256,uint176)` transaction,
  asks the deployed factory for the signer address (`getSigner`), and simulates
  `createSigner` against the factory's own code. The simulation is the proof the
  call would deploy the signer; nothing is sent.
- `apps/web/src/app/onboarding/signer-actions.ts` —
  `preparePasskeySignerDeployment` wires the stored credential's P-256
  coordinates to the engine. `deriveAccount` now shares the factory ABI and the
  `p256Verifiers()` packing with the engine, so the Safe's owner and the signer
  that would be deployed cannot diverge.
- Tests prove the derived address, the simulated address and the encoded
  `createSigner` calldata, and that no send path exists.

## BLOCKED: Account gate not approved

The `createSigner` transaction is prepared and simulated only. Broadcasting it
requires the Account gate (Week 2 contract §7, checkpoint 2). Until then the
signer address has no code on Sepolia, no passkey signature can validate, D3's
"a test signature validates through the signer" is unmet, and D18 (Invest) stays
blocked.

## Runtime proof (read-only dry-run, no send)

A one-off `eth_call` dry-run against a public Ethereum Sepolia RPC confirms the
frozen factory is deployed and that the call path agrees with the derivation.
Synthetic coordinates are used (no resident credential is available); the
returned address is the real contract's output, not a fabricated value.

```text
factory  0x1d31F259eE307358a26dFb23EB365939E8641195  (has code: true)
x, y     1, 2
verifiers 1111636484949241205398856388087597953580887526884
         (= 0x0000 || 0xc2b78104907F722DABAc4C69f826a522B2754De4)
getSigner          -> 0x71b4e34A97F0b6f89df1C423933F7f6E5e953601
createSigner (call) -> 0x71b4e34A97F0b6f89df1C423933F7f6E5e953601
agree: true
```

No transaction was broadcast; the dry-run is a read-only `eth_call`. No RPC
endpoint is configured in the repository, so this is not part of `verify.sh`.

## Not done here

- No `--broadcast`, no `cast send`, no live deployment.
- No service-role key or payer key is read for this path; simulation needs
  neither.
- No change to `packages/shared/**`, `apps/web/src/lib/wallet/**` or
  `apps/web/src/components/shell/nav.ts`.
