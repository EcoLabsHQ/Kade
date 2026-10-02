/**
 * The Colosseum residency environment gate.
 *
 * The Colosseum residency track is an off-by-default demonstration surface. It
 * is enabled only by an explicit environment flag:
 *
 *     KADE_COLOSSEUM=1
 *
 * The value must be exactly the string `1`; anything else (unset, empty,
 * `true`, `yes`, `0`) leaves the surface disabled. It is a single, server-read
 * flag — never a query parameter or a header — so a caller cannot turn it on.
 *
 * This mirrors `apps/web/src/app/vault/withdraw/gate.ts`.
 */

/** The environment variable that enables the Colosseum residency surface. */
export const COLOSSEUM_ENV = 'KADE_COLOSSEUM';

/**
 * Whether the Colosseum residency surface is enabled. Reads the flag at call
 * time, so a route and its actions judge the same value and a test can toggle
 * it.
 */
export function isColosseumEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[COLOSSEUM_ENV] === '1';
}
