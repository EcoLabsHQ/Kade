# Known gaps and deliberate shortcuts

Kade Week 1 is a **hackathon MVP**, not a production system. Incomplete,
simplified and mocked things are expected and acceptable, provided they are
declared here rather than discovered later.

## How to read this

- Nothing in this file is a defect. It is **declared scope**.
- An item here is not a review finding. A review finding is a false claim, a
  weakened test, a security regression, or behaviour that contradicts the
  documentation.
- What is *not* relaxed by the MVP posture: committed secrets, presenting mock
  state as real, claiming verification that did not happen, and gates that
  report success on failure. Those stay blocking at any maturity level.

See `docs/week-1-frozen-delivery-contract.md` section 9 for what is formally out
of scope for Week 1.

## Register

| Area | State | Why | Revisit |
|---|---|---|---|
| Onboarding Steps 1–2 screen | Built: stepper rail, applicant fields, citizenship and residence chips, tier cards, household editor, live fee | D5 | Faithfulness review against the handoff screenshots |
| `/onboarding` validation and save | Validation delegates to `@kade/shared`; persistence goes through `save_onboarding_step2` against the live project | Exercised end to end: a signed-in run wrote the profile, household and Safe record | Done |
| Fee at runtime | **Resolved.** The server reads the active `fee_schedule` row and `public.preapproval_fee_usdc(mode, household_size)`; the client previews only through a server action and can supply no amount. `applications.preapproval_usdc` is still recomputed by the trigger and read back | The runtime path reads the database, not the shared formula (contract section 2.1) | Done |
| Passkey credential metadata | **Persisted, including the signer.** Enrolment writes `passkey_credentials` and the server-derived `signer_address`; `/account` reloads the stored credential server-side | `signer_address` is deliberately not granted to `authenticated`, so it is written by `public.save_passkey_signer` — a `SECURITY DEFINER` function scoped to the caller's own credential. **No service-role key is needed for enrolment.** The function takes the address as an argument (it is derived off-chain), so a resident could set the signer on their *own* credential by calling it directly; what is closed is naming another resident's signer and changing an existing one | None |
| Safe WebAuthn signer address | **Derived** (see the row above; no service key is involved). The credential's public key is parsed to its P-256 coordinates and `SafeWebAuthnSignerFactory.getSigner` is called for the address, through a server action so the RPC provider key stays server-side | The factory is the authority: its address depends on its immutable singleton and the proxy creation code it was compiled with, which this repository does not reproduce | Done |
| Payer gas exposure | **Declared.** Any authenticated resident who creates a passkey causes a transaction from the shared payer account, because the deployment is eager and wired into onboarding | The address is deterministic, so a repeat is free, but the first one per resident costs gas. There is no allowlist or rate limit: a resident who can sign in can spend the payer's balance. The payer holds a small testnet balance, so the exposure is bounded by funding rather than by a control | Add an allowlist or a per-resident cap before the payer holds anything of value |
| Safe WebAuthn signer contract | **Not deployed. The call path now exists but is gated.** The Safe's only owner is `0x1696b162F45Ed054fB8ED27Bd715721D5ae13270`, and that address has no code on Sepolia. `apps/web/src/lib/safe/signer.ts` builds the `SafeWebAuthnSignerFactory.createSigner(x, y, verifiers)` transaction and simulates it against the deployed factory's own code (`preparePasskeySigner`), and `preparePasskeySignerDeployment` wires it to the stored credential. It deliberately has **no send path**: the deployment is an irreversible on-chain write and the Week 2 Account gate is not approved, so every result is marked `gated: true` and nothing is broadcast | The signer is a contract the factory deploys on first use. The simulation proves the call would deploy the same address the Safe's ownership commits to, but until it is actually sent the owner exists as an address, not a contract, so a passkey signature cannot validate and D3's "a test signature validates through the signer" remains unmet. (The Week 2 contract §6.4's "nothing calls `createSigner`" predates this simulation-only path.) | Account gate approval, then send the prepared `createSigner` transaction and call it as part of the Safe setup |
| Safe address derivation | `packages/contracts/src/SafeAddress.sol` derives the CREATE2 address; `apps/web/src/lib/safe/` mirrors it, and `deriveAccount` reads the signer address and the proxy creation code from the deploying contracts | The Safe release and its addresses come from Safe's published deployments, and the two inputs that cannot be reproduced locally come from the chain, so no input is a placeholder. The Foundry test's pinned creation code is *our* build and is not used to derive addresses — see the next row | Done — the Safe is deployed |
| Safe `SafeProxy` creation code | **The deployed factory's code is not this repository's build.** Ours: 649 bytes, `keccak256 = 0xa547798e…adc906cf`. The deployed v1.5.0 factory's `proxyCreationCode()`: 438 bytes, `keccak256 = 0x941b3e88…b87e12` | The creation code is part of the CREATE2 digest, so deriving from our own build produced an address the factory would never deploy. Found in review, after an earlier value had been pinned in tests as correct. The application now reads the code from the factory at runtime; `DEPLOYED_SAFE_PROXY_CREATION_CODE` records the value so the mismatch is reviewable, and a regression test asserts the two hashes do not converge | None — the chain is read at runtime |
| Salt nonce strategy | **Proposed, not approved.** `residentSaltNonce` derives it as `keccak256(userId)`, so each resident's address is stable and distinct with no server-side counter to lose | This was the Account-gate pack's open question ("what makes each resident's address unique"). Chosen here as the obvious answer, but it fixes every resident's address, so it should be confirmed at the gate before any further deployment | Account gate (D4) |
| Account address is counterfactual until deployed | The account step shows the derived Safe address and its deployment state | A Safe address exists before the Safe does; a counterfactual address is the normal state, not a claim that a contract is on chain. A Safe **is** deployed on Sepolia for the test resident, and the shell distinguishes deployed from not-deployed | Done |
| Safe address on the login screen | Withheld; the screen says the account will be set up after sign-in | The login screen has no session, so there is no resident whose address it could show | None |
| Account step (create passkey) | Shows the account address once the passkey exists, and no caveat about it | Creating a passkey is the ordinary path for a new resident, so the screen reads like a product screen rather than a status report. If the chain is unreachable the passkey still succeeds and the address is simply not shown, because the passkey is created and usable regardless | None |
| Steps 3 and 4 (proof of wealth, pre-approval fee) | Step 3 performs real read-only balance reads from every source. A signed-in resident can connect a **browser-extension or WalletConnect wallet** (Reown AppKit) and its account's balances are read from the same public provider as a pasted address; or paste up to 5 Bitcoin addresses (BTC + USD from `mempool.space`) and up to 5 pasted EVM (`0x…`) addresses (**native coin and USDC** on the Ethereum and Base **mainnets** from a Blockscout-compatible explorer, native valued at the explorer's price and USDC at its 1:1 peg). Pasted rows are persisted to `public.wallets` (`provider = 'bitcoin-address'` / `'pasted-address'`, `siwe_sig`/`verified_at` NULL); a connected wallet is persisted with the distinct `provider = 'connected-wallet'` and `siwe_sig`/`verified_at` NULL (contract v1.2). Paying the fee is real on Sepolia (v1.9) | The v1.9 wallet connection is reused read-only by the proof-of-wealth rows (contract v1.10); a connected wallet and a pasted **EVM** address persist unverified and appear in Holdings in one **"In linked wallets"** list, labelled per row and **excluded from the total** (contract v1.2–v1.4), and can be verified there by connecting the controlling wallet and signing; the qualified-vault action is gated on that verification and is presented as unavailable while KadeLock is undeployed; wallet login stays excluded. ERC-20 balances **other than USDC** and balances on Arbitrum, Optimism and Celo are not read (the chain list is data, so they can be added by configuration later). Hardware wallets and the background indexer remain out of scope | Week 2 (more chains and tokens, indexer) |
| Pasted Bitcoin addresses are not ownership-verified | A resident supplies an address and the server reads its balance from a public source; there is no signature, no wallet connection and no ownership proof, and `wallets.verified_at` is left NULL — the documented "unverified" meaning. The UI states the balance was read from a public source and is not evidence of control | A read-only balance display is in scope for Week 1 (contract v1.7); proving control is not, and no claim of control is made | Add ownership proof / SIWE when wallet connection lands |
| Pasted EVM addresses are not ownership-verified | A resident supplies up to 5 `0x…` addresses and the server reads each one's **native coin and USDC** balances on the Ethereum and Base mainnets from a public Blockscout-compatible explorer; there is no signature, no wallet connection and no ownership proof, and `wallets.verified_at` is left NULL — the documented "unverified" meaning. The UI states the balances were read from a public source and are not evidence of control. Reading only USDC among ERC-20s, and only on the two product chains, is a deliberate limit: other tokens and balances on Arbitrum, Optimism and Celo are not read | A read-only balance display is in scope (contract v1.7, extended v1.8); proving control is not, and no claim of control is made. The chain list is data, so more chains and tokens can be added by configuration later | Add ownership proof / SIWE when wallet connection lands; add other tokens and chains by configuration |
| Dashboard figures | The pre-approved state is mocked: the fee receipt, the three attestations and the residency stages are the reference's demo values, labelled demo in the banner and a chip | Payments, attestations and the indexer are out of Week 1, so those records do not exist. The Safe address itself is real and read from the record; the figures around it are not | As each lands |
| Safe address in the dashboard | Shown from the deployment record, with its state and an explorer link | Read from `safe_deployments`, never fabricated; a resident with no record sees "no account yet" | Done |
| Fee shown in the web app | **Resolved.** Read from `fee_schedule` server-side; a client-supplied amount cannot change it, and an unreadable schedule disables payment rather than inventing a value | Superseded by the row above | Done |
| Vote, Holdings, Invest, Bank↔Crypto, Card | Rendered locked, not implemented | Out of Week 1 scope | Weeks 3–4 |
| Admin toggle | Links to `/admin` for a user with a `reviewers` row; a disabled label otherwise | D19 made the review surface real; RLS (`is_reviewer()`) is the gate, the toggle is navigation only | Done |
| KadeLock | Compiled and tested only; not deployed | Frozen model A; deployment is out of scope | Post-Week 1 |
| EAS schemas | **Registered on Ethereum Sepolia.** All five registered by the owner from `0x9907Edd6D403AC420cF1A84b10f0d134b13baa84`; the UIDs, transactions and blocks are recorded in `packages/contracts/eas/registered-uids.json`, and `npm run eas:verify` re-reads the registry and confirms each schema string, resolver and revocable flag against the manifest | Registration is irreversible; it was executed once the Onchain gate was approved. The EAS tooling generates and verifies the plan and never broadcasts; the transactions were sent by the owner. The repository's only send path is the resident-Safe deployment engine, which is wired into onboarding and has deployed a Safe | Done |
| Database tests (fee formula) | pgTAP suite `supabase/tests/0001_fee_recompute.test.sql` covers the formula, the recompute triggers, mode switching and the definer path; no RLS coverage | It proves only our own arithmetic, not row visibility, and is run by hand rather than by any gate. `pgtap` is available on the project, so it can also run there | When RLS enforcement needs a gate |
| RLS | Policies written and reviewed as SQL; no harness exercises row visibility | Enforcement is Postgres's; the removed RLS harness produced four review findings (contract v1.1) | Only if it earns its keep |
| Live Google sign-in | **Completed end to end by the project owner**: the session was established and restored. The redirect boundary was verified directly by the agent | Reported by the project owner, not independently reproduced by the agent | Done |
| Email magic link | Provider enabled and the form is live, and the agent's tests cover the send path, but no link has been delivered and followed | Depends on the project's SMTP and on a mailbox | First delivered link |
| Google OAuth provider | Enabled. The app also detects a disabled provider and says so instead of failing into raw JSON | — | Done |
| Supabase project | **Provisioned.** All 28 committed migrations and the seed are applied; 20 tables, RLS on every one, 9 deny-by-default, the fee function and its triggers verified live (`preapproval_fee_usdc('demo', 3)` = 1.75, `('production', 3)` = 447). Migration 20 (`20260921000001_bitcoin_wallet_addresses.sql`) is applied: `wallets` carries the owner policy, the `record_wallet_address`/`delete_wallet_address` RPCs and the 5-address cap trigger, with `siwe_sig`/`verified_at` select-only. Migration 21 (`20260921000002_evm_wallet_addresses.sql`) extends that cap to the pasted EVM rows and adds `delete_wallet_addresses`. Migration 22 (`20260921000003_record_preapproval_fee_tx.sql`) adds `record_preapproval_fee_tx(text)`, the `SECURITY DEFINER` writer for `applications.fee_tx` scoped to `profile_id = auth.uid()`, and the unique index on `(profile_id, fee_tx)`. Migrations 21 and 22 applied 21 Sep. Migration 30 (`20260922000030_wallet_ownership_proof.sql`) adds the ownership-proof challenge table and `record_wallet_ownership`; migrations 40/41 (`20260922000040_residency_service_fee.sql`, `20260922000041_residency_records_read.sql`) add `applications.service_tx`, `residency_service_fee_usdc`, `record_residency_service_fee_tx` and the residency read policies; migration 60 (`20260922000060_admin_review.sql`) opens the reviewer surface. Migrations 30, 40, 41 and 60 applied 22 Sep. Migration 27 (`20260923000001_connected_wallet_provider.sql`, contract v1.2) is comment-only — it records the `connected-wallet` provider encoding — and migration 28 (`20260923000002_connected_wallet_sticky.sql`, review finding F2) is DDL — it makes the `connected-wallet` encoding sticky (a connected write re-encodes an existing unverified row; a pasted write never changes one) and adds the column-scoped `grant update (provider)`. **Migrations 27 and 28 were applied to the live project on 23 Sep 2026**, verified live: `authenticated` holds `UPDATE` on `provider` only (`verified_at` and `siwe_sig` remain ungranted), and `record_wallet_address` is `SECURITY INVOKER` with `search_path = public, pg_temp` and the sticky conflict clause. Migration 28's own header comment retains its authoring-time "neither is applied … yet" wording; the applied text is the committed text, so that is a comment artifact, not an applied-vs-committed divergence | Project-supplied dependency | Done |
| Migration 13 applied text vs committed file | **Declared divergence, not a defect.** The applied `passkey_credentials` statement omits the `comment on column public.passkey_credentials.signer_address` and `comment on column public.passkey_credentials.public_key` statements and the table comment's "Holds no private key and no raw attestation" wording that `20260916000013_passkey_credentials.sql` contains; the same apply additionally ran `select public.reset_demo_data();` and a count select the file does not contain. Confirmed live: `col_description('public.passkey_credentials'::regclass, …)` for `signer_address` is NULL. The committed file is the intended text | The divergence predates this iteration's work — every committed version of the file carries the comments — and correcting an already-applied migration means rewriting history or re-applying, neither of which a documentation pass does | Re-apply the committed file the next time the schema is reset |
| Migration 11 applied comment vs committed file | **Declared divergence, not a defect.** The live `comment on function public.save_onboarding_step2(...)` is shorter than the committed `20260916000011_save_onboarding.sql`: it lacks the "Replaces a sequence of browser-side PostgREST calls…" sentence. The committed file is the intended text | Predates this iteration's work, and the same history/re-apply constraint as migration 13 applies | Re-apply the committed file the next time the schema is reset |
| Migrations 02, 08 and 09 comments later contradicted | **Declared, accepted.** `20260916000002_applications.sql` and `20260916000008_config.sql` describe `preapprovalFeeUsdc()` in `@kade/shared` as "the single implementation" of the fee, and `20260916000009_rls.sql` says it is "the single place RLS is enabled"; migrations 10/13 later add `public.preapproval_fee_usdc()` and RLS for `passkey_credentials`, so the comments inside those files are now false | Those files were deliberately restored to their applied text rather than edited: the file must match the statement the database already ran, so the internal contradiction is the accepted cost. The corrections live in the later migrations (10, 15) and in this repository's docs | Reconcile when the migration set is next reset and comment-only corrections can be applied in order |
| CI | Present. GitHub Actions runs `./scripts/verify.sh` on push and pull request against `main` (`.github/workflows/ci.yml`) | The canonical gate now runs without a human remembering; no secrets are configured or required | Add `verify-full.sh` when its extra checks are wired |
| Design system | Design tokens ported as inline styles on primitives | Fast, and faithful to the vendored handoff at `reference/design-handoff/` | When the real UI lands |

## Deliberate simplifications

These are choices, not omissions:

- **`[arbitrary]` values** are labelled as such in code and in the threat model
  rather than invented confidently.
- **KadeLock has a single admin**, no timelock and no second signer. It blocks
  non-allowlisted native-value transactions only; ERC-20 and call data are not
  inspected. The production shape is recorded as a future improvement in the
  threat model.
- **No wallet login; ownership proof is Holdings-only.** The external wallet
  connection is payment-only (v1.9), read-only for balances (v1.10) and persisted
  unverified (v1.2–v1.4); it does not establish a session. A signature over a
  server-issued challenge proves control for **Holdings only** (D17) and is not a
  login. The passkey remains the only transaction authority.
- **No indexer.** Nothing aggregates balances.

## If you are reviewing this repository

Judgement to apply:

- Declared gaps above → not findings.
- Undeclared gaps, stale claims, or a gate that passes while proving nothing →
  findings.
- Mock data rendered as if real → finding, always.

## Declared limitations of the `known-good` promotion

This section exists because `known-good` was moved to a commit that did **not**
pass adversarial review. It is written down so the tag cannot silently acquire a
meaning it does not have.

- **The promotion was an owner decision, not a passed gate.** The development
  contract requires *both* gates before `known-good` moves. Mechanical
  verification passed (`./scripts/verify.sh`, nine gates). The adversarial review
  did not: it failed ten times in this iteration, and at the tenth it still
  reported one blocking finding and three warnings. The owner chose to promote
  with the limitation declared rather than continue correcting. **The tag
  therefore means "mechanically verified, promoted by owner decision, review
  outstanding" — not the usual "both gates passed".** The contract has not been
  amended, so this deviation is recorded here rather than resolved.

- **The documentation sweep is manual, and it is not complete.** All ten failures
  were one semantic class: statements in live files contradicted by facts this
  iteration changed — Safe v1.5.0 decided, the deployment addresses recorded, the
  signer derived from the passkey, the proxy creation code read from the
  deploying factory. The reviews converged but never reached zero. **No
  mechanical check enforces this class.** That is the root cause: enumerating by
  keyword cannot catch a claim that is expressed without any of the keywords, and
  the ninth review found exactly such an instance. A regression guard was
  proposed for this and was not authorised, so the exposure remains.

- **The four instances the tenth review left uncorrected have since been fixed.**
  They were the last surviving statements contradicted by this iteration's
  changes, and a later `stale-claims` pass corrected each one against the code:

  | Location | Correction |
  |---|---|
  | `docs/architecture/kadelock-threat-model.md` §8 | The row label no longer lists `signer` among the deployment inputs; the row states it is derived per resident |
  | `packages/shared/src/safe.ts` | `SafeDeploymentInputs` no longer types `signer` as a `Sourced` input, because it is derived, not configured |
  | `docs/week-1-frozen-delivery-contract.md` §8.6 | The clause now says the Foundry test pins *this repository's* `SafeProxy` build, not the deployed factory's creation code |
  | `packages/shared/src/auth.ts` | The credential-metadata fact is now true: enrolment persists to `passkey_credentials`, so the metadata survives reload |

  The underlying exposure is unchanged: the sweep is still manual and no
  mechanical check enforces this class.

## Declared limitations of this promotion

`known-good` was moved to a commit that did **not** pass adversarial review. It is
recorded here so the tag cannot silently acquire a meaning it does not have.

- **The promotion was an owner decision, not a passed gate.** Mechanical
  verification passed (`./scripts/verify.sh`, nine gates). The adversarial review
  did not: it failed eight times in this iteration. The owner chose to promote
  with the limitation declared rather than continue correcting. **The tag means
  "mechanically verified, promoted by owner decision, review outstanding" — not
  the usual "both gates passed".** The development contract has not been amended,
  so this deviation is declared inside it rather than resolved by it.

- **The documentation is not fully reconciled with the current state.** All eight
  failures were one class: a live file asserting something the current state
  contradicts. The facts that moved this iteration are large — a Safe is deployed
  on Sepolia, the EAS schemas are registered, the signer and the Safe record are
  written by SECURITY DEFINER functions with no service-role key, the deployment
  engine is wired into onboarding, and the app is responsive. Prose across roughly
  fifty files describes the previous state in places.

  Each fix corrected the instance a review named and missed the layer beneath it;
  the eighth review found the *reasoning* two lines below the model that had just
  been corrected. **The method is the defect**: this class is semantic, so
  enumerating it by keyword cannot close it, and no mechanical check enforces it.
  A regression guard was proposed for this and was not authorised, so the exposure
  remains.

- **What is known to be outstanding.** The last review's findings, left
  uncorrected by the owner's decision, are the remaining write-authority phrasing
  in `apps/web/src/lib/passkey/store.ts`, `env.ts` and `passkey-actions.ts`, and
  any further prose that describes the pre-deployment state. They are declared, so
  they are not review findings under this register's own rules — they are recorded
  because a reader deserves to know they are there.

- **The product is not affected.** The two reported bugs are fixed and verified;
  the Safe is deployed and confirmed on chain; the EAS schemas are registered and
  re-read by the repository's own verifier. What is outstanding is prose, not
  behaviour.
