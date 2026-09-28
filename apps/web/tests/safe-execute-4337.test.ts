import { describe, expect, it } from 'vitest';
import {
  pimlicoUrl,
  readPimlicoConfig,
} from '@/lib/safe/execute-safe-4337';

/**
 * The Pimlico configuration the resident-Safe flow reads.
 *
 * The one-call send path was removed: the passkey assertion is browser-only, so
 * building and signing cannot happen in a single server call and the two-phase
 * flow in `safe-4337-split.test.ts` is the only send path. What remains here is
 * the configuration those phases share.
 */

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  values as unknown as NodeJS.ProcessEnv;

const ENV = env({ PIMLICO_API_KEY: 'pim_test', PIMLICO_POLICY_ID: 'sp_test' });

describe('readPimlicoConfig', () => {
  it('returns null unless both keys are present', () => {
    expect(readPimlicoConfig(11155111, env({}))).toBeNull();
    expect(readPimlicoConfig(11155111, env({ PIMLICO_API_KEY: 'k' }))).toBeNull();
    expect(readPimlicoConfig(11155111, env({ PIMLICO_POLICY_ID: 'p' }))).toBeNull();
  });

  it('builds the chain-scoped endpoint', () => {
    const config = readPimlicoConfig(11155111, ENV);
    expect(config).not.toBeNull();
    expect(pimlicoUrl(config!)).toBe(
      'https://api.pimlico.io/v2/11155111/rpc?add_balance_override&apikey=pim_test',
    );
  });
});
