-- =============================================================================
-- The account address now comes from Safe's SDK, not from Kade's own arithmetic.
--
-- Why this changes
--   `safe_deployments` was written to record a create2 derivation Kade performed
--   itself: reading `SafeProxyFactory.proxyCreationCode()`, hashing the
--   initializer, and reproducing the digest. Every column below was therefore
--   NOT NULL, because Kade computed all of them.
--
--   Under Safe's passkey model that is no longer true. The address is obtained
--   from Safe's own SDK, exactly as its guides show:
--
--     const pack = await Safe4337Pack.init({ provider, signer: passkey, ... })
--     const safeAddress = await pack.protocolKit.getAddress()
--
--   The SDK composes the initializer, chooses the factory and singleton, and
--   derives the salt. Kade never sees those inputs, and the resident's passkey —
--   not a signer contract — is the owner.
--
-- What is relaxed, and why not faked
--   The columns the SDK does not expose become nullable. They are NOT filled
--   with placeholders: a fabricated `factory` or `salt` would be a false record
--   of how the account was created, which is worse than recording that the SDK
--   chose it. The fields that remain meaningful stay NOT NULL:
--
--     * `safe_address` — the point of the row;
--     * `deployment_chain_id`;
--     * `owner` — now the passkey's signer address, which the SDK does report;
--     * `threshold`.
--
--   A fresh row is `status = 'predicted'`: the account exists as an address and
--   becomes a contract with its first user operation. That is the state the UI
--   presents as "created — appears on chain with the first operation".
--
-- Nothing is deleted and no existing row is altered: a row that already carries
-- the create2 inputs keeps them, and a row written by the SDK path simply leaves
-- them empty.
-- =============================================================================

alter table public.safe_deployments
  alter column predicted_l2_addresses drop not null,
  alter column safe_version          drop not null,
  alter column factory               drop not null,
  alter column singleton             drop not null,
  alter column initializer           drop not null,
  alter column handler               drop not null,
  alter column salt                  drop not null,
  alter column creation_code_assumptions drop not null;

comment on column public.safe_deployments.factory is
  'The SafeProxyFactory address, when Kade derived the address itself. NULL for '
  'an account whose address came from Safe''s SDK (EIP-4337 path), which chooses '
  'the factory and does not report it. Never filled with a placeholder.';
comment on column public.safe_deployments.singleton is
  'The Safe singleton, when Kade derived the address itself. NULL on the SDK '
  'path, for the same reason as `factory`.';
comment on column public.safe_deployments.initializer is
  'The initializer calldata, when Kade derived the address itself. NULL on the '
  'SDK path: the SDK composes it from the owner set and threshold.';
comment on column public.safe_deployments.handler is
  'The compatibility fallback handler, when Kade derived the address itself. '
  'NULL on the SDK path.';
comment on column public.safe_deployments.salt is
  'The salt nonce, when Kade derived the address itself. NULL on the SDK path: '
  'the SDK chooses it and does not expose it.';
comment on column public.safe_deployments.predicted_l2_addresses is
  'The same address on other chains, when Kade derived it. Empty on the SDK '
  'path, which derives per chain.';
comment on column public.safe_deployments.safe_version is
  'The Safe version, when Kade derived the address itself. NULL on the SDK path.';
comment on column public.safe_deployments.owner is
  'The account''s owner. Under Safe''s passkey model this is the signer derived '
  'from the resident''s passkey, NOT a deployed SafeWebAuthnSigner contract. It '
  'is the only derivation input the SDK reports, which is why it stays NOT NULL.';
