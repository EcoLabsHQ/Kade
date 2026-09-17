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
| Onboarding Steps 1–2 screen | Placeholder; fields disabled, save nothing | The MVP UI codebase is expected from the project; recreating it now would be rework | When the UI source arrives |
| `/onboarding` validation and save | Not implemented | Same as above; the field contract and data layer come first | With the UI |
| Fee at runtime | Computed from the shared formula + `KADE_FEE_MODE`, not read from the active `fee_schedule` row | One formula, one source; the table is seeded and authoritative for display | Small change; contract says "from the active `fee_schedule`" |
| Passkey credential metadata | In-memory seam; does not survive reload | No reachable database from the web app | When a Supabase project exists |
| Safe WebAuthn signer address | Unresolved sentinel, never a fabricated address | Requires the Account-gate deployment inputs | Account gate |
| Safe address on the login screen | Withheld, labelled "not yet deployed" | Nothing is deployed | After D4 |
| Dashboard stat values | `—`, "no data source configured" | Deliberately not fabricated | When data sources exist |
| Vote, Holdings, Invest, Bank↔Crypto, Card | Rendered locked, not implemented | Out of Week 1 scope | Weeks 3–4 |
| Admin toggle | Rendered locked | Admin review UI is out of scope | Week 3 |
| KadeLock | Compiled and tested only; not deployed | Frozen model A; deployment is out of scope | Post-Week 1 |
| EAS schemas | Manifest only; nothing registered | Registration is irreversible and Onchain-gate blocked | Onchain gate |
| RLS | Policies written and reviewed as SQL; no test harness | Enforcement is Postgres's; the harness produced four review findings and was removed (contract v1.1) | Only if it earns its keep |
| Live Google sign-in | Real code path, unverified | No Supabase project or Google credentials available | When credentials exist |
| Supabase project | None provisioned | Project-supplied dependency | Foundation gate |
| CI | None | Local `verify.sh` is the gate | Optional |
| Design system | Design tokens ported as inline styles on primitives | Fast, and faithful to the reference | When the real UI lands |

## Deliberate simplifications

These are choices, not omissions:

- **`[arbitrary]` values** are labelled as such in code and in the threat model
  rather than invented confidently.
- **KadeLock has a single admin**, no timelock and no second signer. It blocks
  non-allowlisted native-value transactions only; ERC-20 and call data are not
  inspected. The production shape is recorded as a future improvement in the
  threat model.
- **No external wallet connection.** Out of scope; the passkey is the only
  transaction authority.
- **No indexer.** Nothing aggregates balances.

## If you are reviewing this repository

Judgement to apply:

- Declared gaps above → not findings.
- Undeclared gaps, stale claims, or a gate that passes while proving nothing →
  findings.
- Mock data rendered as if real → finding, always.
