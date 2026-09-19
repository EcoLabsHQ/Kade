-- =============================================================================
-- Kade — correct the stored public key's description.
--
-- The credential metadata table described `public_key` as a "COSE public key".
-- It is not. The value the browser returns in `response.publicKey` is
-- base64url-encoded SubjectPublicKeyInfo (DER), and that is what the derivation
-- parses to recover the P-256 coordinates. A comment that names the wrong
-- encoding is the kind of claim a later reader trusts.
--
-- Comment-only. No column, constraint or policy changes.
-- =============================================================================

comment on column public.passkey_credentials.public_key is
  'The credential''s public key as the browser reports it: base64url '
  'SubjectPublicKeyInfo (DER), not a COSE key. Parsed to its P-256 coordinates '
  'to derive the Safe WebAuthn signer address. Public by construction; the '
  'private key never leaves the authenticator and is not stored anywhere.';
