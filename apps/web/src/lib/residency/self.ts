/**
 * The Self (self.xyz) Enterprise client (D16 / EXE-012).
 *
 * As amended (week-2 contract v1.7), identity is verified **on chain**: the
 * resident is sent to Self's `verificationUrl`, Self's own contract on Celo
 * Sepolia verifies the passport proof and issues a soulbound token, and Self
 * delivers a signed `verification.completed` webhook back to us. Kade does
 * **not** mint an attestation and does **not** emit `kade.kyc.v1`.
 *
 * This module is the only place that reaches for `@selfxyz/enterprise-sdk`. It:
 *   - reads the server-only Enterprise configuration (`SELF_API_KEY`,
 *     `SELF_WEBHOOK_SECRET`, `SELF_FLOW_ID`);
 *   - creates a verification session for a resident and returns the hosted
 *     `verificationUrl` (Self hosts the QR and the deeplink; we never draw one);
 *   - verifies the Svix signature on a raw webhook body.
 *
 * **Config-gated and honest.** When the keys are absent every entry point reports
 * `not-configured`; nothing fabricates a verification result and `verified` is
 * not a producible outcome of this module. When the keys are present but the
 * SDK is not installed, the path reports `unavailable` with the reason, so the
 * route answers 5xx and Self retries rather than treating the event as handled.
 *
 * **SDK boundary.** `@selfxyz/enterprise-sdk` is ESM-only and Node-only, and it
 * is loaded through a computed dynamic `import()` (marked so bundlers and the
 * type checker do not require the package to be present). The integrator must
 * add it, pinned to an exact version (the SDK is pre-1.0 and minor versions may
 * break), then this module works unchanged.
 */

import type { SelfWebhookEventLike } from './self-event';

/** Server-only Self Enterprise configuration, or null when any part is absent. */
export interface SelfEnterpriseConfig {
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly flowId: string;
}

/**
 * Read the Self Enterprise configuration.
 *
 * All three keys are required: the API key and flow id to create verification
 * sessions, the webhook secret to verify callbacks. A partial configuration is
 * reported as absent rather than half-used. None of the values is
 * `NEXT_PUBLIC_`; they are read here and never returned to the browser.
 */
export function readSelfConfig(): SelfEnterpriseConfig | null {
  const apiKey = process.env.SELF_API_KEY?.trim();
  const webhookSecret = process.env.SELF_WEBHOOK_SECRET?.trim();
  const flowId = process.env.SELF_FLOW_ID?.trim();
  if (!apiKey || !webhookSecret || !flowId) return null;
  return { apiKey, webhookSecret, flowId };
}

export function isSelfVerificationConfigured(
  config: SelfEnterpriseConfig | null = readSelfConfig(),
): boolean {
  return config !== null;
}

/** The narrow slice of the SDK this module uses. */
export interface SelfSessionLike {
  readonly id?: unknown;
  readonly verificationUrl?: unknown;
}

export interface SelfClientLike {
  readonly sessions: {
    create(input: {
      readonly flowId: string;
      readonly externalUuid: string;
    }): Promise<SelfSessionLike>;
  };
}

export interface SelfSdkModule {
  readonly SelfClient: new (options: { readonly apiKey: string }) => SelfClientLike;
  readonly SelfWebhooks: {
    verify(
      payload: string,
      headers: Record<string, string>,
      secret: string,
    ): SelfWebhookEventLike;
  };
  readonly WebhookVerificationError?: new (...args: never[]) => Error;
}

/** The SDK loader seam; injectable so the configured path is testable offline. */
export type SelfSdkLoader = () => Promise<SelfSdkModule>;

/**
 * Load the SDK without making it a build-time dependency of the unconfigured
 * path.
 *
 * The specifier is held in a variable and the import is marked ignored, so the
 * type checker, Vitest and the bundler do not require
 * `@selfxyz/enterprise-sdk` to be installed for the route to exist; a deployment
 * that has configured Self must install it. See the module header.
 */
async function loadSelfSdk(): Promise<SelfSdkModule> {
  const specifier = '@selfxyz/enterprise-sdk';
  const module = (await import(
    /* @vite-ignore */ /* webpackIgnore: true */ specifier
  )) as Partial<SelfSdkModule>;
  if (typeof module.SelfClient !== 'function') {
    throw new Error(
      '@selfxyz/enterprise-sdk did not expose SelfClient; is the expected version installed?',
    );
  }
  if (typeof module.SelfWebhooks?.verify !== 'function') {
    throw new Error(
      '@selfxyz/enterprise-sdk did not expose SelfWebhooks.verify; is the expected version installed?',
    );
  }
  return module as SelfSdkModule;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown error';
}

/**
 * The outcome of starting Self verification.
 *
 * `verified` is deliberately absent: this module starts and verifies, it never
 * decides that a resident is verified — that comes only from a signed webhook
 * (see `./self-event` and `../app/api/webhooks/self`).
 */
export type SelfSessionResult =
  | { readonly status: 'created'; readonly verificationUrl: string; readonly sessionId: string | null }
  | { readonly status: 'not-configured' }
  | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Create a Self verification session for a resident and return the hosted URL.
 *
 * `externalUuid` is the profile id, so the webhook's `external_uuid` resolves
 * back to the resident. Never invents a URL: when the config is absent it
 * reports `not-configured`, and when the SDK or API fails it reports
 * `unavailable` with the reason.
 */
export async function createSelfSession(
  profileId: string,
  config: SelfEnterpriseConfig | null = readSelfConfig(),
  loadSdk: SelfSdkLoader = loadSelfSdk,
): Promise<SelfSessionResult> {
  if (config === null) return { status: 'not-configured' };

  let sdk: SelfSdkModule;
  try {
    sdk = await loadSdk();
  } catch (cause) {
    return { status: 'unavailable', reason: safeMessage(cause) };
  }

  try {
    const client = new sdk.SelfClient({ apiKey: config.apiKey });
    const session = await client.sessions.create({
      flowId: config.flowId,
      externalUuid: profileId,
    });
    const verificationUrl = nonEmptyString(session?.verificationUrl);
    if (verificationUrl === null) {
      return {
        status: 'unavailable',
        reason: 'Self created no verification URL, so there is nothing to open.',
      };
    }
    return {
      status: 'created',
      verificationUrl,
      sessionId: nonEmptyString(session?.id),
    };
  } catch (cause) {
    return { status: 'unavailable', reason: safeMessage(cause) };
  }
}

export type SelfWebhookVerification =
  | { readonly status: 'verified'; readonly event: SelfWebhookEventLike }
  | { readonly status: 'invalid-signature' }
  | { readonly status: 'invalid-payload' }
  | { readonly status: 'not-configured' }
  | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Verify a signed Self webhook and return the typed event, without logging the
 * body or the secret.
 *
 * `invalid-signature` and `invalid-payload` are client errors (400);
 * `unavailable` is a transient or deployment error (5xx) so Self retries;
 * `not-configured` means the credentials are absent.
 */
export async function verifySelfWebhook(
  rawBody: string,
  headers: Record<string, string>,
  config: SelfEnterpriseConfig | null = readSelfConfig(),
  loadSdk: SelfSdkLoader = loadSelfSdk,
): Promise<SelfWebhookVerification> {
  if (config === null) return { status: 'not-configured' };

  let sdk: SelfSdkModule;
  try {
    sdk = await loadSdk();
  } catch (cause) {
    return { status: 'unavailable', reason: safeMessage(cause) };
  }

  try {
    const event = sdk.SelfWebhooks.verify(rawBody, headers, config.webhookSecret);
    return { status: 'verified', event };
  } catch (cause) {
    if (
      typeof sdk.WebhookVerificationError === 'function' &&
      cause instanceof sdk.WebhookVerificationError
    ) {
      return { status: 'invalid-signature' };
    }
    // The SDK throws `SelfValidationError` when the payload matches no known
    // event shape; that is a deterministic client error, not a retry.
    if (cause instanceof Error && cause.name === 'SelfValidationError') {
      return { status: 'invalid-payload' };
    }
    return { status: 'unavailable', reason: safeMessage(cause) };
  }
}
