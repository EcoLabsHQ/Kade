/**
 * The operator-withdrawal environment gate.
 *
 * The operator withdrawal (`/vault/withdraw`) is a deliberately unlinked,
 * passkey-only operator tool for emptying a resident's Safe on the deployment.
 * It is **off by default** and is enabled only by an explicit environment flag:
 *
 *     KADE_OPERATOR_WITHDRAW=1
 *
 * The value must be exactly the string `1`; anything else (unset, empty,
 * `true`, `yes`, `0`) leaves the route and both server actions disabled. It is
 * a single, server-read flag — never a query parameter or a header — so a
 * caller cannot turn it on.
 *
 * See `docs/operator-vault-withdraw.md`.
 */

/** The environment variable that enables the operator withdrawal. */
export const OPERATOR_WITHDRAW_ENV = 'KADE_OPERATOR_WITHDRAW';

/**
 * Whether the operator withdrawal is enabled. Reads the flag at call time, so
 * the route and the actions judge the same value and a test can toggle it.
 */
export function isOperatorWithdrawEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OPERATOR_WITHDRAW_ENV] === '1';
}
