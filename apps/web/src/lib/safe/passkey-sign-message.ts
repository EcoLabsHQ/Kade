import type { Address, Hex } from 'viem';

/**
 * Signing an EIP-712 message through a **passkey-owned** Safe.
 *
 * This is the message-signing counterpart of the resident-Safe engine
 * (`./execute-safe-4337`). That engine signs ERC-4337 **user operations**
 * (transactions); this module signs a Safe **message** — the EIP-1271 shape a
 * Snapshot vote is verified as — with the resident's own passkey, using
 * `@safe-global/protocol-kit`'s documented message API:
 *
 *   Safe.init({ provider, signer: passkeySigner, safeAddress })
 *     → protocolKit.createMessage(typedData)
 *     → protocolKit.signMessage(safeMessage, SigningMethod.ETH_SIGN)
 *     → safeMessage.encodedSignatures()
 *
 * ## Why `ETH_SIGN` and not the default typed-data method
 *
 * `Safe.signMessage`'s default method (`ETH_SIGN_TYPED_DATA_V4`) routes to
 * `signTypedData`, and protocol-kit's passkey client deliberately refuses that
 * path (`"Passkey Signers cannot sign signTypedData, they can only sign data."`,
 * `protocol-kit@8.0.7`). The passkey signs a **raw 32-byte hash** as the WebAuthn
 * challenge, which is exactly what `SigningMethod.ETH_SIGN` does: it computes the
 * Safe message hash and calls `Safe.signHash`, the same function
 * `@safe-global/relay-kit` uses to sign a passkey owner's user operation. The
 * result is a Safe **contract signature** over the Safe message hash, which the
 * Safe's `CompatibilityFallbackHandler` validates through the owner's
 * `isValidSignature(bytes32, bytes)`.
 *
 * `'eth_sign'` is the string value of `SigningMethod.ETH_SIGN`; protocol-kit does
 * not re-export the enum, so the value is used directly and named here so it
 * cannot drift silently.
 *
 * ## The passkey never leaves the browser
 *
 * The private key lives in the platform authenticator and never exists in this
 * process. The caller passes the passkey **signer** (`PasskeyArgType`: the
 * credential id, its public coordinates and the verifier), and the SDK prompts
 * the device for the assertion. Only the resulting Safe signature is returned;
 * no credential material is logged, serialised or returned.
 *
 * ## No network in tests
 *
 * `initSafe` is an injected seam, so a fake proves the flow without a chain or a
 * passkey prompt. The real seam imports the SDK lazily, so importing this module
 * never loads the SDK or dials a network.
 */

/** One field of an EIP-712 type. */
export interface Eip712Field {
  readonly name: string;
  readonly type: string;
}

/**
 * The minimal EIP-712 typed-data shape this module signs.
 *
 * Structurally satisfied by `SnapshotVoteTypedData`; declared here rather than
 * imported so the Safe module does not depend on the vote module.
 */
export interface Eip712TypedData {
  readonly domain: Record<string, unknown>;
  readonly types: Record<string, readonly Eip712Field[]>;
  readonly primaryType: string;
  readonly message: Record<string, unknown>;
}

/**
 * The passkey signer the Safe SDK accepts, as `PasskeyArgType`.
 *
 * `rawId` is the credential id's **bytes as lowercase hex** (the form the SDK
 * expects, see `./passkey-signer`), `coordinates` the P-256 public point, and
 * `verifierAddress` the chain's P-256 verifier. `getFn` is left unset so the SDK
 * prompts the device itself with the challenge it computes.
 */
export interface PasskeySignerArg {
  readonly rawId: string;
  readonly coordinates: { readonly x: string; readonly y: string };
  readonly verifierAddress: string;
  readonly getFn?: () => Promise<Credential>;
}

/** The slice of protocol-kit's `Safe` this module uses for messages. */
export interface SafeMessageProtocolKit {
  createMessage(message: unknown): unknown;
  signMessage(
    message: unknown,
    signingMethod: unknown,
  ): Promise<{ encodedSignatures(): string }>;
}

/** The SDK seam, injected so a test never reaches a chain or a passkey prompt. */
export interface PasskeyMessageSigningDependencies {
  readonly initSafe: (config: {
    readonly provider: string;
    readonly signer: unknown;
    readonly safeAddress: string;
  }) => Promise<SafeMessageProtocolKit>;
  /** The SDK's signing method; production is `SigningMethod.ETH_SIGN`. */
  readonly signingMethod: unknown;
}

export interface PasskeyMessageSigningInput {
  /** The chain's RPC endpoint, read by the SDK to resolve the Safe's state. */
  readonly rpcUrl: string;
  /** The Safe whose owner signs the message (the voter). */
  readonly safeAddress: Address;
  /** The resident's passkey, reconstructed from the stored credential. */
  readonly signer: PasskeySignerArg;
  /** The EIP-712 typed data to wrap and sign. */
  readonly message: Eip712TypedData;
}

/**
 * `SigningMethod.ETH_SIGN` from `@safe-global/types-kit`.
 *
 * protocol-kit does not re-export the enum, so its string value is named here.
 * It is the method that routes to `Safe.signHash` and therefore works with a
 * passkey owner; the typed-data methods do not.
 */
export const PASSKEY_MESSAGE_SIGNING_METHOD = 'eth_sign' as const;

/**
 * Produce the Safe message signature with the resident's passkey.
 *
 * Returns the Safe's `encodedSignatures()` — the EIP-1271 `sig` a verifier such
 * as the Snapshot sequencer submits to `Safe.isValidSignature`. Throws (rather
 * than returning an empty signature) when the SDK produced no signature, so the
 * caller can never mistake an unsigned message for a signed one.
 */
export async function signSafeMessageWithPasskey(
  input: PasskeyMessageSigningInput,
  deps?: PasskeyMessageSigningDependencies,
): Promise<Hex> {
  const resolved = deps ?? (await defaultPasskeyMessageSigningDependencies());

  const protocolKit = await resolved.initSafe({
    provider: input.rpcUrl,
    signer: input.signer,
    safeAddress: input.safeAddress,
  });

  const safeMessage = protocolKit.createMessage(input.message);
  const signed = await protocolKit.signMessage(
    safeMessage,
    resolved.signingMethod,
  );

  const encoded = signed.encodedSignatures();
  if (typeof encoded !== 'string' || !encoded.startsWith('0x') || encoded.length <= 2) {
    throw new Error(
      'The Safe SDK returned no message signature, so nothing was submitted.',
    );
  }
  return encoded as Hex;
}

/**
 * The production seams: protocol-kit's `Safe.init` and `SigningMethod.ETH_SIGN`.
 *
 * Loaded lazily, so importing this module never loads the SDK or prompts a
 * passkey.
 */
export async function defaultPasskeyMessageSigningDependencies(): Promise<PasskeyMessageSigningDependencies> {
  const { default: Safe } = await import('@safe-global/protocol-kit');
  return {
    async initSafe(config) {
      const protocolKit = await Safe.init({
        provider: config.provider,
        signer: config.signer,
        safeAddress: config.safeAddress,
      } as never);
      return protocolKit as unknown as SafeMessageProtocolKit;
    },
    signingMethod: PASSKEY_MESSAGE_SIGNING_METHOD,
  };
}
