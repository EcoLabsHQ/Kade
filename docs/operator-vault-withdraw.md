# Operator withdrawal (Safe → wallet)

An **unlinked, environment-gated operator tool** for emptying a resident's Safe
on the deployment, so the team can test from a clean account.

It is deliberately **not** a resident feature and **not** a covert backdoor: it
is documented here, it is off by default, and it cannot move funds without the
resident's own passkey.

## What it is

`/vault/withdraw` is a browser route that moves a chosen amount of USDC or the
chain's native coin out of the resident Safe to a destination the operator
names. It shows the Safe's balances per supported chain, a chain selector, a
token selector (USDC / native), an amount input with an "all" option, and a
destination address input.

The route drives the **same two-phase passkey flow** as the Invest screen:

1. the server builds the transfer and returns the SafeOp hash
   (`beginOperatorWithdraw`);
2. the browser signs that hash with the resident's passkey;
3. the server submits the retained operation and confirms the receipt
   (`completeOperatorWithdraw`).

Success is reported **only** for a confirmed receipt. Every refusal names the
reason it stopped at.

## The gate — off by default

The route and both server actions are enabled only when:

```text
KADE_OPERATOR_WITHDRAW=1
```

The value must be exactly the string `1`. Unset, empty, `true`, `yes` or `0`
leave the route a **404** (`notFound()`) and both actions disabled. The flag is
read on the server; there is no query parameter or header that can turn it on.

When enabled, the route is still auth-gated like every other app page: a signed
out visitor is redirected to `/login`, and the actions resolve the session and
the **recorded** Safe server-side.

## How to reach it

There is no navigation entry, no link and no button anywhere in the UI. Reach it
by typing the URL directly:

```text
/vault/withdraw
```

It is intentionally unlinked — it is operator tooling, not a resident surface.

## Authority model

The withdrawal does not change who controls the Safe:

- The Safe's **only signer is the resident's WebAuthn passkey.** The operator
  cannot move funds without the resident's passkey assertion.
- **No managed or embedded signer is introduced.** Both phases reuse the existing
  Safe-4337 seam (`buildResidentSafeBatchFromEnv` /
  `submitResidentSafeOperationFromEnv`) — the same seam the Invest deposit uses.
- The **connected browser EOA has no authority.** It is never used to sign or
  send anything here.

In other words, this tool is a convenience wrapper around the resident's own
authority: it removes the UI detour, not the passkey requirement.

## Server-side validation

Before anything is built or signed, `beginOperatorWithdraw` refuses with a
specific reason when:

- the environment flag is off;
- there is no session, no stored passkey, or no recorded Safe;
- the client-named Safe is not the recorded Safe;
- the chain is not one of the configured vault chains (Ethereum mainnet, Base,
  Arbitrum One);
- the destination is not a valid non-zero address, or is the Safe itself;
- the amount is not a positive base-unit integer; or
- the amount exceeds the Safe's balance of the chosen token on that chain (or
  that balance could not be read).

## Configuration

Add the flag to the web app's environment (never the repository root):

```text
KADE_OPERATOR_WITHDRAW=1
```

Leave it unset or empty to keep the route disabled. See `.env.example` for the
commented entry.
