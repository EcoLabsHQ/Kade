import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regression: the membership read resolved its RPC for the wrong chain.
 *
 * This failed before.
 *
 * `loadVoteViewerMembership` read the `MembershipManager` chain id from
 * `readMembershipChainId()` (Arbitrum One, 42161) but resolved the RPC from the
 * active chain environment:
 *
 *     const rpcUrl = readRpcUrlFor(readChainEnv());
 *
 * Under `KADE_CHAIN_ENV=testnet` that is `SEPOLIA_RPC_URL`. The manager is
 * deployed on Arbitrum One, so the read was issued against Sepolia, found
 * nothing, and failed closed (`read.status === 'known' ? … : 'none'`). A resident
 * who is genuinely a Citizen was then refused the citizen-only Snapshot proposal
 * with "Colosseum Citizens only".
 *
 * This must continue working: the RPC must be resolved through the **same** chain
 * id the manager is read on (`readRpcUrlForChain(chainId)`), never through the
 * chain environment. The suite lives here, not beside the module, because the
 * development contract requires regression coverage in `tests/regressions/` and
 * because it must be visible to the regression gate in `scripts/verify.sh`.
 *
 * It asserts the source shape deliberately: the invariant is *which resolver is
 * called with which argument*, and the regression suite runs in a Node
 * environment without the app's `@/` path alias, so the module's `@/lib/env`
 * import cannot be loaded here. The behavioural proof lives beside the screen in
 * `apps/web/tests/vote-membership-rpc.test.ts`.
 */

const SOURCE_PATH = fileURLToPath(
  new URL('../../apps/web/src/lib/vote/server.ts', import.meta.url),
);
const source = readFileSync(SOURCE_PATH, 'utf8');

/** Remove `//` and block comments so a comment can never satisfy a check. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** The brace-balanced body of the named function. */
function functionBody(name: string): string {
  const clean = stripComments(source);
  const start = clean.indexOf(`function ${name}(`);
  expect(start, `${name} must exist in server.ts`).toBeGreaterThanOrEqual(0);
  const braceStart = clean.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < clean.length; index += 1) {
    if (clean[index] === '{') depth += 1;
    else if (clean[index] === '}') {
      depth -= 1;
      if (depth === 0) return clean.slice(braceStart, index + 1);
    }
  }
  throw new Error(`could not find the body of ${name}`);
}

describe('regression: the membership read resolves its RPC for the manager chain', () => {
  const body = functionBody('loadVoteViewerMembership');

  it('reads the chain id once and resolves the RPC through that same chain', () => {
    expect(body).toMatch(/const\s+chainId\s*=\s*readMembershipChainId\(\)/);
    expect(body).toMatch(/readRpcUrlForChain\(\s*chainId\s*\)/);
  });

  it('never resolves the RPC from the active chain environment', () => {
    // The exact defect: the manager on Arbitrum One, the RPC on Sepolia.
    expect(body).not.toMatch(/readRpcUrlFor\s*\(/);
    expect(body).not.toMatch(/readChainEnv\s*\(/);
  });
});
