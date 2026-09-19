/**
 * Passkey credential shapes shared by the store, the server actions and the
 * account panel.
 *
 * Kept free of any server-only import so the client panel can import these
 * types without pulling the database seam into the browser bundle.
 */

/**
 * A credential as it is actually stored.
 *
 * `signerAddress` is nullable because the column is written with the service
 * role: when that capability is absent the credential still persists but the
 * derived signer address stays NULL rather than being faked.
 */
export interface StoredPasskeyCredential {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signerAddress: string | null;
  readonly transports: readonly string[];
  readonly userVerification: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

/**
 * What the browser may send when saving an enrolment.
 *
 * There is deliberately no signer address field: it is derived server-side and
 * a client-supplied value is ignored.
 */
export interface SavePasskeyCredentialInput {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly transports: readonly string[];
  readonly userVerification: boolean;
}

/** How the signer address fared during a save. */
export type SignerPersistence =
  | { readonly status: 'persisted'; readonly address: string }
  | { readonly status: 'not-persisted'; readonly reason: string };

export interface SavePasskeyCredentialResult {
  readonly credential: StoredPasskeyCredential;
  readonly signer: SignerPersistence;
}
