import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSelfSession,
  isSelfVerificationConfigured,
  readSelfConfig,
  verifySelfWebhook,
  type SelfEnterpriseConfig,
  type SelfSdkModule,
} from '@/lib/residency/self';

/**
 * The Self Enterprise client (D16 / EXE-012, contract v1.7).
 *
 * `@selfxyz/enterprise-sdk` is not installed in this repository, so the
 * configured path is exercised through the injectable SDK loader; the absent
 * path is exercised with the real loader, which must degrade honestly rather
 * than fabricate a URL.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function configure(): void {
  vi.stubEnv('SELF_API_KEY', 'sk_test');
  vi.stubEnv('SELF_WEBHOOK_SECRET', 'whsec_test');
  vi.stubEnv('SELF_FLOW_ID', 'flow-uuid');
}

const CONFIG: SelfEnterpriseConfig = {
  apiKey: 'sk_test',
  webhookSecret: 'whsec_test',
  flowId: 'flow-uuid',
};

class FakeWebhookVerificationError extends Error {
  constructor(message = 'invalid signature') {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

function fakeSdk(
  create: (input: { flowId: string; externalUuid: string }) => Promise<unknown>,
  verify: (payload: string, headers: Record<string, string>, secret: string) => unknown = () => ({
    type: 'verification.completed',
  }),
): SelfSdkModule {
  return {
    SelfClient: class {
      readonly sessions = { create };
    },
    SelfWebhooks: { verify },
    WebhookVerificationError: FakeWebhookVerificationError,
  } as unknown as SelfSdkModule;
}

describe('readSelfConfig', () => {
  it('is null without the Self configuration', () => {
    expect(readSelfConfig()).toBeNull();
    expect(isSelfVerificationConfigured()).toBe(false);
  });

  it('reports a partial configuration as absent', () => {
    configure();
    vi.stubEnv('SELF_FLOW_ID', '');
    expect(readSelfConfig()).toBeNull();
  });

  it('reads the supplied configuration', () => {
    configure();
    expect(readSelfConfig()).toEqual(CONFIG);
    expect(isSelfVerificationConfigured()).toBe(true);
  });
});

describe('createSelfSession', () => {
  it('reports not-configured without the keys and never loads the SDK', async () => {
    const loader = vi.fn();
    const outcome = await createSelfSession('profile-1', null, loader);
    expect(outcome).toEqual({ status: 'not-configured' });
    expect(loader).not.toHaveBeenCalled();
  });

  it('reports unavailable when the SDK is not installed', async () => {
    const outcome = await createSelfSession('profile-1', CONFIG, async () => {
      throw new Error('Cannot find module @selfxyz/enterprise-sdk');
    });
    expect(outcome.status).toBe('unavailable');
    if (outcome.status === 'unavailable') {
      expect(outcome.reason).toMatch(/enterprise-sdk/);
    }
  });

  it('creates a session with the flow id and the profile id', async () => {
    const create = vi.fn(async () => ({
      id: 'sess_1',
      verificationUrl: 'https://self.xyz/v/abc',
    }));
    const outcome = await createSelfSession('profile-1', CONFIG, async () =>
      fakeSdk(create),
    );

    expect(outcome).toEqual({
      status: 'created',
      verificationUrl: 'https://self.xyz/v/abc',
      sessionId: 'sess_1',
    });
    expect(create).toHaveBeenCalledWith({
      flowId: 'flow-uuid',
      externalUuid: 'profile-1',
    });
  });

  it('never invents a URL when Self returns none', async () => {
    const outcome = await createSelfSession('profile-1', CONFIG, async () =>
      fakeSdk(async () => ({ id: 'sess_1' })),
    );
    expect(outcome.status).toBe('unavailable');
  });

  it('reports unavailable when the API call fails', async () => {
    const outcome = await createSelfSession('profile-1', CONFIG, async () =>
      fakeSdk(async () => {
        throw new Error('401 unauthenticated');
      }),
    );
    expect(outcome.status).toBe('unavailable');
  });
});

describe('verifySelfWebhook', () => {
  it('reports not-configured without the keys', async () => {
    const outcome = await verifySelfWebhook('{}', {}, null, vi.fn());
    expect(outcome).toEqual({ status: 'not-configured' });
  });

  it('returns the typed event for a valid signature', async () => {
    const event = { type: 'verification.completed', status: 'valid' };
    const outcome = await verifySelfWebhook('{"raw":true}', { 'svix-id': 'm' }, CONFIG, async () =>
      fakeSdk(async () => ({}), () => event),
    );
    expect(outcome).toEqual({ status: 'verified', event });
  });

  it('maps a signature error to invalid-signature', async () => {
    const outcome = await verifySelfWebhook('{}', {}, CONFIG, async () =>
      fakeSdk(async () => ({}), () => {
        throw new FakeWebhookVerificationError();
      }),
    );
    expect(outcome).toEqual({ status: 'invalid-signature' });
  });

  it('maps an unknown payload shape to invalid-payload', async () => {
    const outcome = await verifySelfWebhook('{}', {}, CONFIG, async () =>
      fakeSdk(async () => ({}), () => {
        const error = new Error('no known event');
        error.name = 'SelfValidationError';
        throw error;
      }),
    );
    expect(outcome).toEqual({ status: 'invalid-payload' });
  });

  it('reports unavailable when the SDK is missing, so Self retries', async () => {
    const outcome = await verifySelfWebhook('{}', {}, CONFIG, async () => {
      throw new Error('Cannot find module @selfxyz/enterprise-sdk');
    });
    expect(outcome.status).toBe('unavailable');
  });
});
