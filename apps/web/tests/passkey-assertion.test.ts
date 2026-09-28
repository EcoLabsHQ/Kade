import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAssertionOptions,
  promptPasskeyAssertion,
  promptPasskeyAssertionParts,
  withAssertionPrompt,
} from '@/lib/passkey/assertion';
import {
  credentialIdToRawId,
  type PasskeySigner,
} from '@/lib/safe/passkey-signer';

/**
 * The passkey assertion, which is what Safe asks for when it signs.
 *
 * Enrolment creates the credential; this is the only other place the WebAuthn
 * API is reached. These tests pin the request shape (the challenge and the
 * credential id must be signed exactly as issued) and that the prompt is wired
 * onto the signer Safe is given.
 */

const CHALLENGE = 'Y2hhbGxlbmdl'; // "challenge" in base64url
const CREDENTIAL_ID = '63726564'; // "cred" bytes, as hex (Safe's rawId form)

const SIGNER: PasskeySigner = {
  rawId: CREDENTIAL_ID,
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAssertionOptions', () => {
  it('asks for the exact challenge and credential, with user verification', () => {
    const options = buildAssertionOptions({
      credentialId: CREDENTIAL_ID,
      challenge: CHALLENGE,
      rpId: 'localhost',
    });

    expect(options.challenge).toBe(CHALLENGE);
    expect(options.rpId).toBe('localhost');
    // D3: the transaction passkey must require user verification.
    expect(options.userVerification).toBe('required');
    // Safe carries the credential id as hex; WebAuthn's JSON form needs
    // base64url, so the option is converted here rather than passed through.
    expect(options.allowCredentials).toEqual([
      {
        id: 'Y3JlZA',
        type: 'public-key',
        transports: ['internal', 'hybrid'],
      },
    ]);
  });
});

describe('promptPasskeyAssertion', () => {
  it('passes the challenge and credential id to the platform as bytes', async () => {
    const get = vi.fn(async () => ({ id: 'assertion' }) as unknown as Credential);
    vi.stubGlobal('navigator', { credentials: { get } });
    vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'));

    await promptPasskeyAssertion({
      credentialId: CREDENTIAL_ID,
      challenge: CHALLENGE,
      rpId: 'localhost',
    });

    expect(get).toHaveBeenCalledTimes(1);
    const request = (
      get as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]?.[0] as {
      publicKey: { challenge: Uint8Array; allowCredentials: { id: Uint8Array }[] };
    };
    // WebAuthn takes BufferSource, not the base64url strings of its JSON form.
    expect(request.publicKey.challenge).toBeInstanceOf(Uint8Array);
    expect(request.publicKey.allowCredentials[0]?.id).toBeInstanceOf(Uint8Array);
  });

  it('fails loudly when the prompt returns nothing', async () => {
    vi.stubGlobal('navigator', { credentials: { get: vi.fn(async () => null) } });
    vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'));

    await expect(
      promptPasskeyAssertion({
        credentialId: CREDENTIAL_ID,
        challenge: CHALLENGE,
        rpId: 'localhost',
      }),
    ).rejects.toThrow(/no assertion/);
  });

  it('reports honestly when WebAuthn is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(
      promptPasskeyAssertion({
        credentialId: CREDENTIAL_ID,
        challenge: CHALLENGE,
        rpId: 'localhost',
      }),
    ).rejects.toThrow(/not available/);
  });
});

describe('withAssertionPrompt', () => {
  it('attaches the prompt so Safe can ask for the assertion when it signs', () => {
    const withPrompt = withAssertionPrompt(SIGNER, 'localhost', CHALLENGE);

    expect(typeof withPrompt.getFn).toBe('function');
    // The identity Safe needs is unchanged; only the prompt is added.
    expect(withPrompt.rawId).toBe(SIGNER.rawId);
    expect(withPrompt.verifierAddress).toBe(SIGNER.verifierAddress);
  });
});

describe('credentialIdToRawId', () => {
  it('converts the stored base64url id to the hex form Safe expects', () => {
    // The SDK builds rawId as Buffer.from(credential.rawId).toString('hex').
    // Kade stores base64url, so passing it through unconverted made the SDK
    // reject it: Invalid byte sequence ("0x" in "0xggXbr…").
    expect(credentialIdToRawId('Y3JlZA')).toBe('63726564');
    expect(credentialIdToRawId('Y3JlZA')).not.toMatch(/^0x/);
  });

  it('round-trips through the WebAuthn form used when asserting', () => {
    const rawId = credentialIdToRawId('Y3JlZA');
    const options = buildAssertionOptions({
      credentialId: rawId,
      challenge: CHALLENGE,
      rpId: 'localhost',
    });
    // Hex in, base64url out — the two forms must agree on the same bytes.
    expect(options.allowCredentials?.[0]?.id).toBe('Y3JlZA');
  });
});

describe('promptPasskeyAssertionParts', () => {
  // A 32-byte SafeOp hash, the shape the build phase returns.
  const HASH = `0x${'ab'.repeat(32)}`;

  it('converts the hex challenge to base64url and serialises the three pieces', async () => {
    const authenticatorData = new Uint8Array([1, 2, 3, 4]);
    const signature = new Uint8Array([48, 6, 2, 1, 1, 2, 1, 2]);
    const clientDataJSON = new Uint8Array([123, 125]);
    const get = vi.fn(async () => ({
      response: { authenticatorData, signature, clientDataJSON },
    }) as unknown as Credential);
    vi.stubGlobal('navigator', { credentials: { get } });
    vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'));

    const parts = await promptPasskeyAssertionParts({
      credentialId: CREDENTIAL_ID,
      challenge: HASH,
      rpId: 'localhost',
    });

    // The platform sees the hash's bytes as the challenge, base64url-encoded in
    // the JSON form (43 chars for 32 bytes, no padding).
    const request = (
      get as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]?.[0] as { publicKey: { challenge: Uint8Array } };
    expect(Buffer.from(request.publicKey.challenge).toString('hex')).toBe(HASH.slice(2));
    expect(Buffer.from(request.publicKey.challenge).toString('base64url')).toHaveLength(43);

    // The three pieces come back as base64url for transport, byte-for-byte.
    expect(parts.authenticatorData).toBe(Buffer.from(authenticatorData).toString('base64url'));
    expect(parts.signature).toBe(Buffer.from(signature).toString('base64url'));
    expect(parts.clientDataJSON).toBe(Buffer.from(clientDataJSON).toString('base64url'));
  });

  it('fails loudly when the assertion is missing a response field', async () => {
    const get = vi.fn(async () => ({
      response: { authenticatorData: new Uint8Array([1]) },
    }) as unknown as Credential);
    vi.stubGlobal('navigator', { credentials: { get } });
    vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'));

    await expect(
      promptPasskeyAssertionParts({
        credentialId: CREDENTIAL_ID,
        challenge: HASH,
        rpId: 'localhost',
      }),
    ).rejects.toThrow(/authenticatorData/);
  });
});
