# Kade MVP — Week 4 Delivery Contract

**Status:** Frozen v1.0 — recorded 6 October 2026 from the review sessions
`.review/demo-feedback-4/` through `.review/demo-feedback-13/`  
**Delivery window:** 5–11 October 2026 (build guide §10, Week 4); the work
recorded here ran 5–6 October 2026  
**Scope:** **this increment** — the Colosseum membership contracts (two soulbound
ERC-721 + ERC-5192 collections and a manager, **deployed on Arbitrum One**), the
app-side "prepare, record, index — never send" membership flow, the Snapshot
Vote surface with a **mocked** source and real eligibility logic, and the
presentational and UX work delivered alongside them.

This contract records what the Week 4 increment delivered and states the
condition on which it may be promoted. It does not re-open the frozen Week 3
contract (`docs/week-3-frozen-delivery-contract.md`, Frozen v1.0), the Week 2
contract (`docs/week-2-frozen-delivery-contract.md`, Frozen v1.8 with amendments
to v1.10), or the Week 1 contract (`docs/week-1-frozen-delivery-contract.md`,
Frozen v1.10) beyond this increment; everything those contracts froze remains
frozen.

## Amendment v1.1 — 7 October 2026

**Supersedes, for the claim path only, the "never send" property recorded in
§1.2 and §2 property 4.**

By explicit human decision taken after this contract was recorded, **the claim
action is the trigger for issuance**: when a resident claims Colosseum
Residency the backend mints the Resident credential, and on the Citizenship
claim it promotes to Citizen. The backend executes a Safe transaction signed by
a server-held key; the resident signs nothing and pays nothing. The app-side
flow therefore **does** sign and broadcast, which contradicts that property as
originally written.

Everything else the property protected still holds: the prepare path remains
`sent: false`, the deployment-plan tooling still never signs or broadcasts, and
the contracts, the frozen Week 1–3 contracts and the KadeLock rules are
untouched. The change was reviewed (demo-feedback-15); its one blocking finding —
an unvalidated client-supplied claim target that could have executed an
irreversible `revokeMembership` — was fixed on the same branch before promotion.

The statements at §1.2 and §2 property 4 are left as written, because they record
what was true when this contract was frozen. This amendment records what
supersedes them.

Where product scope and the development contract disagree, the development
contract governs how work is verified and promoted; this contract governs what is
in scope for the Week 4 increment. Delegated execution follows
`docs/DEVELOPMENT_CONTRACT.md` §17 and `docs/iteration-profiles.md`, which are
referenced here and not restated.

**A note on the authoritative record.** The review sessions
`.review/demo-feedback-4/` … `.review/demo-feedback-13/` are the authoritative
record of what was delivered and what is still open. On `main` the work spans
`bf8925e` (the baseline recorded before session 4) to `a3449e6`; the task's
`097e312` boundary captures sessions 6–13, while sessions 4–5 sit immediately
before it. Every fact below is traced to the repository, a review state, or a
**read-only** on-chain / Snapshot read performed while writing this contract.
Where the committed prose disagrees with the verified state, this contract
records the verified state and names the stale claim rather than repeating it.

## 1. What this contract adds

### 1.1 The on-chain membership layer (MEMBERSHIP-1)

Two soulbound credential collections and a manager, Foundry-tested and
**deployed on Arbitrum One** (chain id `42161`). This is the headline of the
increment.

**Deployed addresses (verified read-only on Arbitrum One):**

| Contract | Address |
|---|---|
| `MembershipManager` | `0x140277660f4f8bFD751CbDEa3De12E174BEEfdA8` |
| `ColosseumResident` | `0x068B747E70750f18C8e6E07a3fbd7Dd35D7FE0b3` |
| `ColosseumCitizen` | `0x36914467AF7EB4862A08da2F26B59b651EeD31BF` |

**Deployment and ownership (verified from logs):** the manager was deployed at
block `512410652` (tx `0x2395c018ee65920e6d2abf9d347273e1ec388db125f479007d46543f0400e1fd`)
to the deployer EOA `0x1726cf86DA996BC4B2F393E713f6F8ef83f2e4f6`. The two
collections were wired with a one-time `setCollections` call at block
`512410758` (tx `0xa8a8eec3a683a5937b3239b6e61177155a5aaeada907ffc9873d3349e1ed0656`).
Ownership was then **transferred from the deployer EOA to the Safe**
`0xa0Ae1C8A46Ab19b6D9A43d5D7564Db9d5517e72c` at block `512415290` (tx
`0xfc7468e1b140eb89533a752454b32d246841c3353f5a499deb4df598ad427fa1`); the
manager's `owner()` now returns the Safe and `pendingOwner()` is the zero
address.

**The owning Safe (verified read-only):** `0xa0Ae1C8A46Ab19b6D9A43d5D7564Db9d5517e72c`,
Safe version **1.5.0**, threshold **1 of 3**, owners
`0xc0bBeB90953033fF4B9021A1743DFdfF870eE714`,
`0x1726cf86DA996BC4B2F393E713f6F8ef83f2e4f6` and
`0x31cd90C2788f3e390d2Bb72871f5aD3F1a4B22a1`.

**Bytecode provenance (verified):** the manager's deployed runtime code hash is
`0xe52d3dea90c321c223a37744ff8031f3d9d35385ac66fb48657f6820c7409bba`, which
equals this repository's build of `src/MembershipManager.sol:MembershipManager`.
The two collections match this repository's build once the embedded immutable
`manager` address is zeroed (`ColosseumResident` → `0xacc7f428…c434cdbf`,
`ColosseumCitizen` → `0xf343240d…67c8b69b`). The deployment is therefore this
repository's source.

**Frozen token rules** (both collections; `src/ColosseumMembership.sol`):

- `balanceOf(wallet)` is `0` or `1` — **one active credential per address**; a
  second `mint` reverts (`AlreadyHoldsCredential`);
- **permanently non-transferable**: every `_update` between two non-zero
  addresses reverts (`Soulbound`), including an approved operator and a
  self-transfer; there is **no unlock function**;
- **revocation burns** the token; token ids start at 1 and only increase, so
  **burned ids are never reused**;
- `locked(tokenId)` returns `true` for an existing token and **reverts** for a
  token that does not exist or was burned (verified: `locked(1)` reverts with
  `ERC721NonexistentToken`, selector `0x7e273289`);
- `supportsInterface(0xb45a3c0e)` (ERC-5192) and `supportsInterface(0x80ac58cd)`
  (ERC-721) both return `true` (verified on-chain);
- **`ERC721Burnable` is deliberately not inherited**, so an owner or approved
  operator cannot burn outside the administrative flow; **only the
  `MembershipManager` may mint or burn**;
- metadata carries name, image and membership type only — **no personal data**.

**The manager** (`src/MembershipManager.sol`):

- `Ownable2Step` with the Safe as owner; **`renounceOwnership` is disabled**
  (`renounceOwnership() public view override onlyOwner` reverts
  `OwnershipRenounceDisabled`, selector `0x118cdaa7`; verified on-chain). The
  owner can move only through the two-step transfer.
- `setCollections` is **one-time** (a second call reverts `CollectionsAlreadySet`)
  and **rejects identical collections** (`CollectionsMustDiffer`), zero
  collections (`ZeroCollection`) and collections whose `manager()` is not this
  manager (`WrongManager`).
- Every membership-changing function is `onlyOwner` and `nonReentrant`, and
  updates state **before** the `_safeMint` callback.
- State machine:
  `None --issueResident--> Resident --promoteToCitizen--> Citizen`;
  `Resident | Citizen --revokeMembership--> None`; invalid transitions revert.
- **Atomic promotion:** the Resident credential is burned and the Citizen
  credential minted in one transaction, so a receiver that rejects the Citizen
  token reverts the whole promotion and leaves the Resident credential intact.

**Foundry tests and the mechanical gate.** The suite is **84 tests**, all
passing: `ColosseumMembershipTest` (13), `KadeLockTest` (30),
`KadeLockSafeIntegrationTest` (3), `MembershipManagerTest` (26) and
`SafeAddressTest` (12). `./scripts/verify.sh` runs `forge build` and `forge test`
in `packages/contracts` as part of the canonical gate (`scripts/verify.sh`
§3).

**Stale committed prose.** The contract source headers, `packages/contracts/README.md`
and `packages/contracts/membership/README.md` still say the membership contracts
are "NOT deployed" and that the change-control approval "does **not** cover a
deployment". That prose is stale: the contracts are deployed on Arbitrum One and
verified above. Correcting those files is outside this documentation-only task
and is recorded here as documentation debt, not as a scope change.

### 1.2 The app-side membership flow (MEMBERSHIP-2)

The "**prepare, record, index — never send**" discipline, under
`apps/web/src/lib/membership/` and `apps/web/src/app/residency/actions.ts`.
Nothing in the module signs, sends or broadcasts; the review verified this by
reading the code and by a repository-wide search for write paths (demo-feedback-12).

- **`plan.ts`** builds the exact owner-Safe call (`{ to, value, data }`) for
  `issueResident` / `promoteToCitizen` / `revokeMembership`, and derives the
  operation from the current and target membership. Every plan is `sent: false`.
  The Safe engine import is type-only.
- **`gate.ts`** is the server-only **issuance gate**
  (`KADE_MEMBERSHIP_ISSUANCE_APPROVED` / `_BY` / `_AT`). It fails closed: with no
  recorded approval, nothing is prepared.
- **`chain.ts`** reads `membershipOf` and distinguishes a **known** state from an
  **unread** one. An unreadable read is never collapsed into "none", so a retry
  cannot duplicate an issuance.
- **`server.ts`** is the prepare entry point: it refuses unless the gate is
  recorded, resolves the member account (the resident's Safe) and the manager
  from records and configuration (never from the client), reads `membershipOf`
  before preparing, derives the operation, persists the intent, and returns
  `not-configured` / `blocked` / `prepared` / `failed` — always with `sent: false`.
- **`store.ts`** is the Supabase-backed record. Intents are written through
  `record_membership_intent`; indexed events through `record_membership_event`,
  both `SECURITY DEFINER`, `service_role`-only, with a pinned `search_path`.
- **`indexer.ts`** reconciles `MembershipChanged` logs **idempotently** on the
  event key (`txHash:logIndex`); an undecodable log is skipped, not guessed, and
  a failed chain read is reported `unread`, never as an applied change.
- **The record and its migration.** `supabase/migrations/20261006000001_membership_transitions.sql`
  creates `public.membership_transitions` with a `confirmed`-event constraint,
  RLS (a resident reads their own rows), a `SELECT` grant to `authenticated`, and
  two unique indexes (the event key, and one pending intent per chain/account/
  operation). **The migration is applied** (verified on the live project: the
  table and both functions exist, RLS is enabled, the `membership_transitions_select_own`
  policy and the grants are present, and the table holds 0 rows). The applied
  migration version string (`20261007010043`) differs from the committed
  filename's timestamp; that is a bookkeeping divergence, not a schema
  divergence — the live columns, functions, policy and grants match the committed
  file. (The demo-feedback-12 session recorded the migration as **not** applied;
  it was applied afterwards, so that note is stale.)
- **The residency seam.** On a confirmed residency permit issuance,
  `issueResidencyPermitAction` best-effort prepares the `resident` transition
  (`apps/web/src/app/residency/actions.ts`). The membership gate is unconfigured
  in this build, so it reports `not-configured` and writes nothing. The Colosseum
  demo citizenship milestone is **deliberately not auto-wired**; the
  `prepareMembershipTransitionAction` is exposed as the seam for it.
- **Deployment-plan tooling** (`packages/contracts/membership/`, `packages/contracts/scripts/generate-membership-deployment-plan.mjs`,
  `packages/contracts/scripts/membership-deployment-plan.mjs`): it produces a reviewable plan —
  deploy order, constructor arguments, predicted CREATE addresses and exact
  calldata — and **fails closed** when any required input is absent. **No script
  signs or broadcasts**, no private key is read, and every result is `sent: false`.
  The plan's committed example carries placeholders; the real inputs file is
  git-ignored. The generated plan's `safe` input records the deployer EOA, not the
  real Safe; the deployed owner is the Safe, because the two-step transfer
  happened after the wiring.

### 1.3 Snapshot (mocked) and the Vote surface (VOTE-2)

The Vote surface was a presentational mock in Week 3 (VOTE-1). This increment
adds the **primitives**, a **swappable adapter** and the **real eligibility
logic**, while keeping the Snapshot source **mocked**.

- **Primitives** (`apps/web/src/lib/vote/types.ts`): `VoteSpace` (with a
  required `category`), `VoteProposal` (with `spaceId`, `proposalId`, `category`,
  `snapshotBlock`, `choices`, `provenance`), and a `VotingPowerRead` that keeps
  `unknown` and `error` distinct from a known zero.
- **The adapter** (`apps/web/src/lib/vote/adapter.ts`): the screen depends on the
  `SnapshotAdapter` interface, never on the mock. The mocked implementation is
  **honest about being mocked**: `mocked: true`, every proposal carries
  `provenance: 'mock'`, the spaces report `created: false`, and a power read is
  labelled `provenance: 'mock'`. A real adapter can report `mocked: false` and
  swap in without touching the screen.
- **Real eligibility logic** (`apps/web/src/lib/vote/eligibility.ts`), in order:
  a disconnected wallet cannot vote; a closed proposal cannot be voted on; a
  **Citizen-only proposal is refused to anyone who is not a Citizen** with the
  exact text **"Colosseum Citizens only"**; an **unreadable** power read refuses
  (never assumed); power must be `> 0`; otherwise eligible. The UI block is a
  companion to the real rule, never the protection.
- **The real space.** The created Snapshot space is **`kadeglobal.eth`** on
  network **`42161`**, strategy **`erc721`** → symbol `KCIT`, address
  `0x36914467AF7EB4862A08da2F26B59b651EeD31BF` (the Citizen contract); its admins
  are two of the three Safe owners. Verified read-only through Snapshot's public API while
  writing this contract. The **second** space does not exist.
- **What is mocked versus real, stated plainly.** Real: the eligibility logic,
  the types, the adapter interface, the mocked adapter's provenance, and the
  on-chain membership read that the Vote page performs. Mocked: the Snapshot
  source itself — there is no live proposal, no EIP-712 signature and no IPFS
  storage; the ballot is local demo state and the tallies and turnout are the
  reference's seeded values.
- **Stale committed configuration.** `apps/web/src/lib/vote/spaces.ts` names
  `onchainisland.eth` and `onchainisland-citizens.eth`, both `created: false`.
  Those names are configuration placeholders that were not updated to the space
  actually created (`kadeglobal.eth`); the code's own `created: false` was
  therefore correct about there being no space at those ids but wrong about the
  programme's real space.
- **Reachability of the citizen rule.** The running `/vote` page loads only
  `RESIDENT_SPACE_ID` and `proposals[0]`, so the citizen-only refusal is
  reachable in the running page only through an injected adapter (as the tests
  do); the page's own proposal is the Resident consultation.

### 1.4 The other delivered items in the increment (UX-1 …)

Checked against the review states; all are covered by focused tests and the
mechanical gate.

- **Colosseum flow redesign** (`ColosseumResidency.tsx`): **one primary action
  per state**. State B shows the four real checks as an **inline checklist
  replacing the modal**; State C's single primary action is "Claim Colosseum
  Residency"; State D's single primary action is "Become a Citizen" and the
  residency pass drops to a quiet text affordance so the two claims never
  compete. The **compliance counter is discreet**: a thin progress line plus
  small muted text carrying the real remaining time (the time stays in the
  accessibility tree). **Both claim buttons are kept explicit** (the residency
  button's label is "Claim Colosseum Residency" / "View residency pass").
- **Shell streaming** (`apps/web/src/app/(resident)/layout.tsx`,
  `components/shell/Shell*`): the chrome **paints immediately** and its data
  **streams**. The two per-resident reads (`loadShellSafe`, `loadReviewBar`) move
  behind `<Suspense>` in async slot components; each fallback fabricates nothing
  (an empty shape, or nothing). The session gate is unchanged and still runs
  before the shell.
- **Certificate reveal motion and its celebration tier** (`FullScreenReveal.tsx`,
  `CitizenshipCertificate.tsx`, `reveal-sound.ts`, `globals.css`): a fused,
  CSS-only reveal with a single light pass, a circular security grid and a
  clipped bloom. The **celebration tier** is one-time and live-only (the first
  transition to citizen); every later open uses the standard tier. The
  citizenship sound cue plays only on the celebration open, is synthesized (no
  asset), and degrades silently.
- **The certificate rename** (`d94e6e2`): the artifact was renamed from
  `CitizenshipPassport` to `CitizenshipCertificate` (and its copy to
  "Colosseum Citizenship Certificate") so it does not collide with the real
  identity passport that Self verifies. The inline artifact and the full-screen
  popup render one shared component.
- **Overlay scroll-lock hardening** (`FullScreenReveal.tsx`): the overlay is a
  clipped region (`overflow: hidden` on both axes) and the body is locked with
  the iOS-safe fixed technique; a short viewport **scales the artifact down with
  no scale floor** rather than scrolling. The reveal computes its scale on mount
  as well as on open, and the guards cover zero/negative height, a missing ref
  and `NaN`.
- **Onboarding completeness fix for legacy rows** (`apps/web/src/lib/onboarding/state.ts`):
  a stored `NULL` gender (mapped to `''`) and a relation outside the current enum
  are treated as satisfied **for the completeness check only**, so a resident who
  finished before the gender/relation rules were added is not sent back through
  onboarding. A value that is present but invalid still blocks, so the rule is not
  weakened for new data. The legacy placeholders never leave the module and are
  never persisted.
- **The corrected post-login destination** (`state.ts`, `auth/callback/route.ts`,
  `login/page.tsx`): `postLoginPath` lands a **completed** resident on the
  Overview (`/`) and an incomplete one on `/onboarding`, and the callback uses the
  same predicate the Overview gate uses so the two cannot disagree. A read failure
  is treated as incomplete.
- **`foundry.toml` `[rpc_endpoints]`** (`ac17b63`): a single `arbitrum =
  "${ARBITRUM_RPC_URL}"` entry, so a network command can say `--rpc-url arbitrum`.
  The URL is read from the environment and never committed. Foundry resolves
  `rpc_endpoints` lazily, so `forge build` / `forge test` are unaffected with the
  variable unset; a command that names the endpoint fails loudly if it is missing.
  No broadcast capability is introduced.

## 2. Frozen properties (acceptance)

1. **The membership contracts are the deployed source.** The manager and the two
   collections deployed on Arbitrum One are this repository's build (bytecode
   verified), the Safe is the manager's owner, and the collections accept only
   the manager as minter/burner.
2. **Soulbound and non-reusable.** One active credential per address, no
   transfer, no unlock, revocation burns, burned ids are never reused, and only
   the manager may mint or burn.
3. **The Safe owns the manager and cannot renounce.** Ownership is the Safe
   (threshold 1 of 3); `renounceOwnership` reverts; ownership moves only through
   the two-step transfer.
4. **Nothing in the app signs or sends.** Every membership plan is `sent: false`;
   the issuance gate is server-only and fails closed; the deployment planner
   fails closed and never broadcasts.
5. **The record is server-written and the chain read is the guard.** A resident
   may read their own transition rows but write none; `membershipOf` is read
   before a prepare so a retry cannot duplicate an issuance; the indexer is
   idempotent on the event key.
6. **The Vote source is mocked and honest.** Every mocked read carries
   `provenance: 'mock'`; the spaces are marked `created: false`; the eligibility
   logic is real and a failed or unknown power read refuses rather than being
   assumed.
7. **Existing behaviour preserved.** No frozen Week 1/2/3 property is weakened;
   the Week 3 presentational decision that the Vote surface carries **no
   on-screen demo banner** is restored (the mock notice added during the flow
   work was removed, demo-feedback-12 F1).

## 3. Declared presentational divergence

The Vote surface remains a declared demonstration layer, exactly as the frozen
Week 3 contract §3 declares. The screen reproduces the reference's copy and
**seeded demo tallies and turnout** that describe a consultation the programme
has not run: no vote is recorded anywhere, no EIP-712 signature is produced, and
nothing is stored on IPFS. The Snapshot source is **mocked by human decision**,
and this contract — not a UI badge — is what makes the mock honest, matching the
frozen Week 3 decision that the screen carries no on-screen demo notice.

The Colosseum citizenship certificate is likewise a **declared demo**: it
confers no real citizenship, status or identity document, and it carries a
"Demo" chip and an explicit disclaimer. The Colosseum residency track reuses the
real residency checks and the real qualified position; its threshold and its
2-minute compliance window are demo-scale.

Residual risk, recorded rather than hidden: the Vote tallies and turnout are
seeded demo values and must not be read as a real result. The membership
contracts are real and deployed, but **no credential has been issued** — the
issuance gate is unconfigured and `membership_transitions` holds no rows.

## 4. Explicit exclusions

This increment does **not** deliver, and does not move into scope:

- **a real Snapshot integration** — the source is mocked by human decision; there
  is no Snapshot client, no EIP-712 signing and no IPFS storage;
- **the second Snapshot space** — only `kadeglobal.eth` exists; the Citizen /
  second space has not been created;
- **any mainnet fund-moving capability** — no deposit, payout, order or transfer
  is added; the membership calls only mint/burn soulbound credentials, and the
  app never sends them;
- **automated credential issuance** — nothing is issued; the gate is
  unconfigured and the backend signer path is undecided (§6);
- **the Citizen issuance trigger** — there is no real Kade state change for
  citizenship (§6);
- GOS integration, card issuance, any fiat rail, recovery, KadeLock deployment,
  and any change to authentication, Safe ownership, EAS schema encoding,
  KadeLock enforcement, wallet-connection authority, database security or the fee
  model.

**Precisely what is deployed versus what is not.** Deployed on Arbitrum One: the
`MembershipManager`, `ColosseumResident` and `ColosseumCitizen`, wired, with the
Safe as owner. Not deployed by this increment: anything else. In particular the
app-side membership flow, the indexer and the deployment planner are code and
records only; the Vote source is mocked; and the residency permit / `kade.kyc.v1`
issuance paths remain gated and un-emitted.

**Change-control fact.** The frozen Week 3 contract §4 excluded "any chain
write" and "a **real** Snapshot vote", and §6 required **explicit human
approval** to move them into scope. The human gave that approval for the
membership **contracts** (recorded in the demo-feedback-10 session, which states
that the approval covers the contracts and not a deployment). The deployment of
the contracts is on-chain and verified; it is recorded here so the change is not
silent. The real Snapshot vote remains excluded and un-approved.

## 5. Acceptance evidence

- **Mechanical gate.** `./scripts/verify.sh` **PASS** on every promoted commit
  (typecheck, lint, unit tests, acceptance tests, regression tests, build,
  `forge build`, `forge test`). The Foundry suite is **84/84 passing**
  (reproduced while writing this contract).
- **Review sessions with no open blocking finding.** Sessions
  `.review/demo-feedback-4/` … `.review/demo-feedback-13/` all returned
  `review_passed`. Sessions 8, 9 and 13 recorded **no findings**; the remaining
  open items are WARNs carried in §6. No open **FAIL** (blocking) finding
  remains.
- **Focused tests** covering the increment:
  `apps/web/tests/membership-plan.test.ts`,
  `membership-server.test.ts`, `membership-indexer.test.ts`,
  `membership-deployment-plan.test.ts`, `vote-eligibility.test.ts`,
  `vote-eligibility-states.test.tsx`, `vote-screen.test.tsx`,
  `residency-colosseum.test.tsx`, `resident-layout.test.tsx`,
  `onboarding-state.test.ts`, and the Foundry
  `test/ColosseumMembership.t.sol` / `test/MembershipManager.t.sol`.
- **On-chain verification a reader can run themselves** (read-only; the RPC URL
  comes from the environment and is never committed):

  ```bash
  export ARBITRUM_RPC_URL="https://lb.drpc.live/arbitrum/<key>"

  cast chain-id --rpc-url "$ARBITRUM_RPC_URL"                     # 42161

  cast call 0x140277660f4f8bFD751CbDEa3De12E174BEEfdA8 "owner()(address)"    --rpc-url "$ARBITRUM_RPC_URL"
  cast call 0x140277660f4f8bFD751CbDEa3De12E174BEEfdA8 "resident()(address)" --rpc-url "$ARBITRUM_RPC_URL"
  cast call 0x140277660f4f8bFD751CbDEa3De12E174BEEfdA8 "citizen()(address)"  --rpc-url "$ARBITRUM_RPC_URL"

  cast call 0x068B747E70750f18C8e6E07a3fbd7Dd35D7FE0b3 "manager()(address)"  --rpc-url "$ARBITRUM_RPC_URL"
  cast call 0x36914467AF7EB4862A08da2F26B59b651EeD31BF "manager()(address)"  --rpc-url "$ARBITRUM_RPC_URL"

  # ERC-5192 / ERC-721 interface support
  cast call 0x068B747E70750f18C8e6E07a3fbd7Dd35D7FE0b3 "supportsInterface(bytes4)(bool)" 0xb45a3c0e --rpc-url "$ARBITRUM_RPC_URL"  # true
  cast call 0x068B747E70750f18C8e6E07a3fbd7Dd35D7FE0b3 "supportsInterface(bytes4)(bool)" 0x80ac58cd --rpc-url "$ARBITRUM_RPC_URL"  # true

  # locked() reverts for a token that does not exist (selector 0x7e273289)
  cast call 0x068B747E70750f18C8e6E07a3fbd7Dd35D7FE0b3 "locked(uint256)(bool)" 1 --rpc-url "$ARBITRUM_RPC_URL"

  # renounceOwnership reverts (selector 0x118cdaa7)
  cast call 0x140277660f4f8bFD751CbDEa3De12E174BEEfdA8 "renounceOwnership()" --rpc-url "$ARBITRUM_RPC_URL"

  # the owning Safe
  cast call 0xa0Ae1C8A46Ab19b6D9A43d5D7564Db9d5517e72c "VERSION()(string)"      --rpc-url "$ARBITRUM_RPC_URL"  # "1.5.0"
  cast call 0xa0Ae1C8A46Ab19b6D9A43d5D7564Db9d5517e72c "getThreshold()(uint256)" --rpc-url "$ARBITRUM_RPC_URL"  # 1
  cast call 0xa0Ae1C8A46Ab19b6D9A43d5D7564Db9d5517e72c "getOwners()(address[])" --rpc-url "$ARBITRUM_RPC_URL"
  ```

  The ownership and wiring history is visible in the logs: an
  `OwnershipTransferred` from the deployer EOA `0x1726…` to the Safe `0xa0Ae…`
  at block `512415290`, and a `CollectionsSet(resident, citizen)` at block
  `512410758`.

- **Snapshot space** (read-only): `https://hub.snapshot.org/api/spaces/kadeglobal.eth`
  returns network `42161` and an `erc721` strategy pointing at the Citizen
  contract `0x36914467AF7EB4862A08da2F26B59b651EeD31BF`.

## 6. Change control and open items

Any change affecting authentication, Safe ownership, EAS schema encoding,
KadeLock enforcement, wallet-connection authority, database security, the
membership contracts' token rules or authority model, or the hour allocation
requires explicit human approval. Promoting the Vote surface from a **mock** to a
real Snapshot integration, or enabling automated credential issuance, is a new
change-control item.

### 6.1 Open WARNs (carried forward honestly)

These are **not** blocking findings; they are recorded so a reader knows they are
there. Sources are the review sessions and `docs/known-gaps.md`.

| Item | Source | State |
|---|---|---|
| `save_onboarding_step2` does not constrain `p_gender` server-side, and completeness now masks an empty gender; a deliberate direct RPC call could store `''`. The only in-app write path validates the enum first; the bypass is self-scoped and yields no privilege gain. | demo-feedback-5 F1 | **Open** |
| The dedupe test (`per-request-dedupe.test.ts`) exercises the loaders directly, not through the layout's four new slot call sites; the `cache()` collapse is sound today but a future regression would not fail a test. | demo-feedback-6 F1 | **Open** |
| State C can render `0:00` and a full compliance bar for one painted frame before the clock effect starts the window. Pre-existing; the new progress bar amplifies it. | demo-feedback-6 F2 | **Open** |
| `scripts/safe-address-vector.mjs` fails **open** when `forge` cannot be executed: it warns and prints constants from a stale artifact with exit 0. Mitigated by the independent test pin, which recompiles `SafeProxy` fresh and fails against stale constants. | demo-feedback-11 F1 | **Open** |
| The real membership store always returns `recorded: true`, so the indexer cannot report a replay (a replay is indistinguishable from a fresh application). Diagnostic-counter inaccuracy in an unwired primitive; no data duplication is possible because of the unique index and on-conflict writer. | demo-feedback-12 F2 | **Open** |

Resolved within the increment: demo-feedback-4 F1 (reduced-motion static sweep),
demo-feedback-7 F1/F2/F3 (mute control, no-scroll, stale comments),
demo-feedback-10 F1/F2/F3 (SafeAddress mechanism, `renounceOwnership`,
`setCollections`), demo-feedback-11 F2/F3, and demo-feedback-12 F1/F3.

**A WARN the review states do not contain.** This contract's brief lists an open
WARN about "the `viem/chains` barrel". A repository-wide search of `.review/`
finds no such finding, and no review state names it. It could not be established
from the repository or the review states and is therefore **not** recorded as an
open item here; if it exists, it lives outside the persisted review record.

### 6.2 The unresolved product decision — the Citizen issuance trigger

The **Residency** trigger exists as a real seam: on a confirmed residency permit
issuance the action prepares the `resident` transition. The residency checks
themselves include the review approval (`applications.status = 'approved'`, the
value the reviewer's `review_events` action flips). There is, however, **no
equivalent real Kade state change for citizenship**: the Colosseum citizenship
milestone is a declared demo, so issuing a real Citizen credential from it is a
product decision, not a wiring detail. `prepareMembershipTransitionAction` is
exposed as the seam and is **deliberately not auto-wired**. This remains open.

### 6.3 The backend signer decision

The manager's owner is the **Safe** (threshold 1 of 3) and every
membership-changing function is `onlyOwner`. Automated issuance from the backend
therefore requires **either** a Safe-owner key (the threshold is 1, so one of the
three owners suffices) **or** a permissioned Safe module. The **module is the
safer, recommended path**, because it does not put an owner key in the server
environment. This decision is **not yet implemented or recorded in the
repository**; it is recorded here as the increment's open decision. The
membership issuance gate is unconfigured, so nothing is prepared today.

**Key hygiene.** The two `*_DEPLOYER_PRIVATE_KEY` Vercel secrets are unreadable
to the agents by design (the demo-feedback-11 session records the Arbitrum
deployment as blocked for want of a deployer key; the reviews note the Vercel
secret is masked and no keystore exists). The server-side backend signer is a
separate, readable key. No private key value is committed.

### 6.4 The deployment-plan tooling's remaining inputs

The planner fails closed until every required input is present:
`chainId`, `chainName`, `rpcUrl` (only its host is recorded), `deployer`,
`safe`, and an optional `deployerNonce` (without it, CREATE addresses and
dependent calldata are reported as unknown). The contracts README additionally
names the inputs a deployment still needs: the target network, the Safe address
that owns the manager, and the wallet ↔ account mapping used to decide who is
issued a credential. The demo-feedback-10 governance note records the four data
points that blocked the broader work: the network, the Safe address, the
wallet-account mapping, and whether a Citizen keeps access to Resident votes.

## 7. Promotion condition

Promotion requires mechanical verification PASS on the exact HEAD and a completed
review session with no open blocking finding, per
`docs/DEVELOPMENT_CONTRACT.md` §15 and §17. The open items in §6 are WARNs, not
blockers, and are carried forward rather than resolved here.
