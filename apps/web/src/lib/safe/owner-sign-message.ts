import { hashTypedData, type Address, type Hex } from 'viem';
import { deriveSignerAddress } from './owner-execute';

/**
 * Signing an EIP-712 message through an owner Safe, with a server-held key.
 *
 * **Not the resident vote path.** The resident authorises their own Snapshot
 * vote with their passkey in the browser (`./passkey-sign-message`); this module
 * signs with a **server-held owner key** and is retained as a generic operator
 * utility. It is deliberately not imported by `@/lib/vote`.
 *
 * This is the **message-signing analogue** of `./owner-execute`. That module
 * builds, signs and executes a Safe *transaction*; this one builds and signs a
 * Safe *message*, which is what EIP-1271 verification consumes:
 *
 *   Safe.init({ provider, signer, safeAddress })
 *     → protocolKit.createMessage(typedData)
 *     → protocolKit.signTypedData(safeMessage, 'v4')
 *     → safeMessage.addSignature(signature)
 *     → safeMessage.encodedSignatures()
 *
 * `createMessage` wraps the caller's EIP-712 typed data (for a Snapshot vote,
 * the canonical `Vote` message) as a Safe message: the Safe's own EIP-712 domain
 * is `{ verifyingContract: <safe>, chainId }` with type
 * `SafeMessage: [{ name: 'message', type: 'bytes' }]`, and `message` is the
 * EIP-712 hash of the wrapped typed data. The owner signs *that*; the Safe's
 * `CompatibilityFallbackHandler` re-wraps the Snapshot hash when the sequencer
 * calls `isValidSignature(bytes32, bytes)`. The returned
 * `encodedSignatures()` is the `sig` Snapshot submits.
 *
 * ## Fail closed before signing
 *
 * The signer key is derived to an address, and that address must be one of the
 * Safe's owners **before anything is signed** — exactly as `owner-execute` does.
 * A malformed key, or a key that does not own the Safe, throws.
 *
 * ## The signer key is never exposed
 *
 * The private key is read on the server, passed only into `Safe.init`, and never
 * logged, returned or serialised. `ownerSafeMessageSigner` redacts it from any
 * error the SDK might echo. The only identity returned is the signer's public
 * address.
 *
 * **No network is reached in tests**: `initSafe` and `hashTypedData` are
 * injected, so a fake proves the flow without a chain.
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

/** The full input one owner-Safe message signature needs. */
export interface SafeMessageSigningInput {
  /** The chain the Safe is on. */
  readonly chainId: number;
  /** The RPC endpoint for that chain. */
  readonly rpcUrl: string;
  /** The Safe whose owners sign the message (the voter for a Snapshot vote). */
  readonly safeAddress: Address;
  /**
   * The server-held Safe owner private key. Read from the server environment
   * and never logged, returned or serialised.
   */
  readonly privateKey: string;
  /** The EIP-712 typed data to wrap and sign. */
  readonly message: Eip712TypedData;
}

export interface SafeMessageSignature {
  /**
   * The Safe signature bytes (`encodedSignatures()`), the value Snapshot sends
   * as `sig`. The Safe's `isValidSignature` accepts exactly this.
   */
  readonly signature: Hex;
  /** The EIP-712 hash of the wrapped message (informational). */
  readonly messageHash: Hex;
  /** The owner that produced the signature. */
  readonly signer: Address;
}

/** The slice of protocol-kit's `SafeMessage` this module uses. */
export interface SafeMessageLike {
  addSignature(signature: unknown): void;
  encodedSignatures(): string;
}

/** The slice of protocol-kit's `Safe` this module uses. */
export interface ProtocolKitMessageLike {
  getOwners(): Promise<readonly string[]>;
  createMessage(message: unknown): SafeMessageLike;
  signTypedData(
    message: SafeMessageLike,
    methodVersion?: 'v3' | 'v4',
  ): Promise<unknown>;
}

/** The two SDK seams, injected so a test never reaches a chain. */
export interface SafeMessageSigningDependencies {
  readonly initSafe: (config: {
    readonly provider: string;
    readonly signer: string;
    readonly safeAddress: string;
  }) => Promise<ProtocolKitMessageLike>;
  /** Defaults to viem's `hashTypedData`. */
  readonly hashTypedData: (message: Eip712TypedData) => Hex;
}

/**
 * Sign one EIP-712 message through the owner Safe, signed by the server-held
 * owner key.
 *
 * Fails closed on a malformed key or a signer that is not one of the Safe's
 * owners, before anything is signed. The returned signature is the Safe's
 * encoded owner signatures, ready to submit as Snapshot's `sig`.
 */
export async function signSafeOwnerMessage(
  input: SafeMessageSigningInput,
  deps: SafeMessageSigningDependencies = defaultSafeMessageSigningDependencies(),
): Promise<SafeMessageSignature> {
  const signerAddress = deriveSignerAddress(input.privateKey);
  if (signerAddress === null) {
    throw new Error(
      'The owner-Safe signer key is not a valid 32-byte private key, so no ' +
        'message was signed.',
    );
  }

  const protocolKit = await deps.initSafe({
    provider: input.rpcUrl,
    signer: input.privateKey,
    safeAddress: input.safeAddress,
  });

  const owners = await protocolKit.getOwners();
  const isOwner = owners.some(
    (owner) => owner.toLowerCase() === signerAddress.toLowerCase(),
  );
  if (!isOwner) {
    throw new Error(
      'The configured signer is not an owner of the voter Safe, so no message ' +
        'was signed.',
    );
  }

  const safeMessage = protocolKit.createMessage(input.message);
  const signature = await protocolKit.signTypedData(safeMessage, 'v4');
  safeMessage.addSignature(signature);

  return {
    signature: safeMessage.encodedSignatures() as Hex,
    messageHash: deps.hashTypedData(input.message),
    signer: signerAddress,
  };
}

/** Replace every occurrence of `secret` in `message` with a marker. */
function redact(message: string, secret: string): string {
  if (secret.length === 0) return message;
  return message.split(secret).join('[redacted]');
}

/**
 * A generic seam for a server-held owner-key message signer: it already carries
 * the secrets, so a caller never sees them. It is **not** used by the resident
 * vote path — the resident signs with their passkey (`./passkey-sign-message`).
 */
export type SafeMessageSigner = (input: {
  readonly chainId: number;
  readonly message: Eip712TypedData;
}) => Promise<SafeMessageSignature>;

/**
 * Bind the environment-resolved secrets into a {@link SafeMessageSigner}.
 *
 * A caller receives the bound signer, so it never handles the key. The
 * low-level `sign` seam is injectable for tests. Any error the signer throws is
 * **redacted**, so a message that happened to contain the key (for example from
 * an SDK that echoes its input) is returned without it.
 */
export function ownerSafeMessageSigner(input: {
  readonly rpcUrl: string;
  readonly safeAddress: Address;
  readonly privateKey: string;
  readonly sign?: (
    input: SafeMessageSigningInput,
    deps?: SafeMessageSigningDependencies,
  ) => Promise<SafeMessageSignature>;
}): SafeMessageSigner {
  const sign = input.sign ?? signSafeOwnerMessage;
  return async ({ chainId, message }) => {
    try {
      return await sign({
        chainId,
        rpcUrl: input.rpcUrl,
        safeAddress: input.safeAddress,
        privateKey: input.privateKey,
        message,
      });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      throw new Error(redact(text, input.privateKey));
    }
  };
}

/**
 * The production seams: protocol-kit's `Safe.init` and viem's `hashTypedData`.
 *
 * `initSafe` is loaded lazily, so importing this module never loads the SDK or
 * dials a network. `hashTypedData` is a pure viem function (viem is already a
 * dependency of every vote module) and is used directly.
 */
export function defaultSafeMessageSigningDependencies(): SafeMessageSigningDependencies {
  return {
    async initSafe(config) {
      const { default: Safe } = await import('@safe-global/protocol-kit');
      const protocolKit = await Safe.init({
        provider: config.provider,
        signer: config.signer,
        safeAddress: config.safeAddress,
      } as never);
      return protocolKit as unknown as ProtocolKitMessageLike;
    },
    hashTypedData(message) {
      return hashTypedData(message) as Hex;
    },
  };
}
