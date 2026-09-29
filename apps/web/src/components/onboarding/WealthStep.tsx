'use client';

import { useState } from 'react';
import { TIERS } from '@kade/shared';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Modal } from '@/components/ui/Modal';
import { tokens } from '@/components/ui/tokens';
import {
  MAX_BITCOIN_ADDRESSES,
  MAX_WALLET_ADDRESSES,
  type BitcoinAddressRecord,
  type EvmAddressRecord,
} from '@/lib/wealth/types';
import {
  summarizeWealth,
  type ConnectedWalletSummary,
} from '@/lib/wealth/summary';
import { BitcoinGlyph } from '@/components/icons/BitcoinGlyph';
import { EvmAddressGlyph } from '@/components/icons/EvmAddressGlyph';
import {
  ConnectedWalletPanel,
  type ConnectedWalletOwnership,
  type ConnectedWalletState,
} from '@/components/wallet/ConnectedWalletPanel';
import { chainColor } from '@/lib/wealth/chain-colors';
import { shortAddress, usd } from '@/lib/wealth/format';

/** The widest qualifying figure, used only to scale the progress track. */
const TIER_SCALE_MAX = Math.max(...TIERS.map((tier) => tier.minUsdc));

const BITCOIN_ORANGE = '#F7931A';

/**
 * Step 3 — show proof of wealth.
 *
 * Three sources, and the screen says which is which. Browser extension and
 * WalletConnect are REAL: they open the Reown AppKit modal, and the connected
 * account's balance is read from the same public provider (Ethereum and Base)
 * that everything else uses. Bitcoin and pasted EVM ("wallet address") rows are
 * watch-only: the server reads the balance from a public source with no
 * signature and no ownership proof. A connected wallet is saved first and then
 * *offered* a signature; only signing marks it verified in Holdings, and it is
 * skippable. Nothing here is
 * mocked, and no path here gives Kade authority over the resident Safe.
 */

export interface WealthStepProps {
  /** False when no WalletConnect project id is configured for this environment. */
  readonly walletConfigured: boolean;
  /** The distinct connected wallets, reported by the panel. */
  readonly connectedWallets: readonly ConnectedWalletSummary[];
  readonly onWalletChange: (
    states: readonly ConnectedWalletState[] | null,
  ) => void;
  readonly onContinue: () => void;
  readonly onBack: () => void;
  readonly tierName: string;
  readonly tierMinimum: number;
  readonly bitcoinAddresses: readonly BitcoinAddressRecord[];
  readonly onAddBitcoin: (address: string) => Promise<void> | void;
  readonly onRemoveBitcoin: (id: number) => Promise<void> | void;
  readonly evmAddresses: readonly EvmAddressRecord[];
  readonly onAddWalletAddress: (address: string) => Promise<void> | void;
  readonly onRemoveWalletAddress: (address: string) => Promise<void> | void;
  /**
   * Persist a wallet connected through the browser extension or WalletConnect.
   * Writes the distinct `connected-wallet` provider, so the row appears in
   * Holdings as unverified and is excluded from the total. Separate from
   * `onAddWalletAddress`, which is the pasted path and stays excluded by
   * construction.
   */
  readonly onSaveConnectedWallet: (address: string) => Promise<void> | void;
  /**
   * The ownership-proof callbacks, injected by the page. When supplied, a
   * connected wallet is saved and then offered a signature: signing marks it
   * verified in Holdings. Signing is always skippable and never gates Continue.
   */
  readonly ownership?: ConnectedWalletOwnership;
}

function btc(value: string | null): string {
  return value === null ? '—' : `${value} BTC`;
}

export function WealthStep({
  walletConfigured,
  connectedWallets,
  onWalletChange,
  onContinue,
  onBack,
  tierName,
  tierMinimum,
  bitcoinAddresses,
  onAddBitcoin,
  onRemoveBitcoin,
  evmAddresses,
  onAddWalletAddress,
  onRemoveWalletAddress,
  onSaveConnectedWallet,
  ownership,
}: WealthStepProps) {
  const [addressInput, setAddressInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [bitcoinOpen, setBitcoinOpen] = useState(false);

  const [evmInput, setEvmInput] = useState('');
  const [evmAdding, setEvmAdding] = useState(false);
  const [evmError, setEvmError] = useState<string | null>(null);
  const [evmOpen, setEvmOpen] = useState(false);
  // The address awaiting the resident's confirmation, or null when none is.
  // Nothing is persisted until this is confirmed.
  const [pendingEvm, setPendingEvm] = useState<string | null>(null);

  const summary = summarizeWealth({
    connectedWallets,
    evmAddresses,
    bitcoinAddresses,
  });
  const total = summary.total;
  const shortfall = Math.max(0, tierMinimum - total);
  const progress = Math.min(100, (total / TIER_SCALE_MAX) * 100);
  const targetMark = Math.min(100, (tierMinimum / TIER_SCALE_MAX) * 100);

  const hasRealRead =
    summary.bitcoinCount > 0 ||
    summary.walletAddressCount > 0 ||
    summary.connectedCount > 0;

  const atCap = bitcoinAddresses.length >= MAX_BITCOIN_ADDRESSES;
  const confirmDisabled = addressInput.trim() === '' || atCap || adding;

  const evmAtCap = evmAddresses.length >= MAX_WALLET_ADDRESSES;
  const evmConfirmDisabled = evmInput.trim() === '' || evmAtCap || evmAdding;

  const canContinue =
    summary.bitcoinCount > 0 ||
    summary.walletAddressCount > 0 ||
    summary.connectedCount > 0;

  async function handleConfirm() {
    const address = addressInput.trim();
    if (address === '' || atCap || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAddBitcoin(address);
      setAddressInput('');
    } catch (cause) {
      setAddError(
        cause instanceof Error
          ? cause.message
          : 'The address could not be read from the network.',
      );
    } finally {
      setAdding(false);
    }
  }

  /**
   * Stage the pasted address for confirmation. The address joins the total only
   * after the resident confirms it in the dialog; this click persists nothing.
   */
  function requestEvmAdd() {
    const address = evmInput.trim();
    if (address === '' || evmAtCap || evmAdding) return;
    setEvmError(null);
    setPendingEvm(address);
  }

  /** The confirmed add: read the address from a public source and store it. */
  async function confirmEvmAdd() {
    const address = pendingEvm;
    if (address === null || evmAdding) return;
    setEvmAdding(true);
    setEvmError(null);
    try {
      await onAddWalletAddress(address);
      setEvmInput('');
      setPendingEvm(null);
    } catch (cause) {
      // Keep the dialog open with the server's own message so the resident can
      // retry or cancel rather than losing the address they confirmed.
      setEvmError(
        cause instanceof Error
          ? cause.message
          : 'The address could not be read from a public source.',
      );
    } finally {
      setEvmAdding(false);
    }
  }

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <div style={eyebrow}>Step 3 of 4</div>
      <h1 style={heading}>Show proof of wealth</h1>
      <p style={lead}>
        One signature per wallet reads your balances on Ethereum, Base,
        Arbitrum, Optimism and Celo — nothing moves. This only shows you can
        meet the tier; moving funds into a qualified vault happens inside the
        platform.
      </p>

      <div
        className='kade-grid-wealth'
        style={{
          gap: '16px',
          alignItems: 'start',
          maxWidth: '1160px',
        }}
      >
        <div style={{ display: 'grid', gap: '10px' }}>
          <ConnectedWalletPanel
            configured={walletConfigured}
            onChange={onWalletChange}
            onSaveConnectedWallet={onSaveConnectedWallet}
            ownership={ownership}
            atCap={evmAtCap}
          />

          <Card padding='14px 16px'>
            <div style={rowHeaderStyle}>
              <span
                aria-hidden
                style={{ ...badgeStyle, background: BITCOIN_ORANGE }}
              >
                <BitcoinGlyph size={22} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 600 }}>Bitcoin</div>
                <div style={rowSubtitleStyle}>
                  Watch-only address · read-only
                </div>
              </div>
              {bitcoinAddresses.length > 0 ? <ReadState /> : null}
              <button
                type='button'
                onClick={() => setBitcoinOpen((open) => !open)}
                aria-expanded={bitcoinOpen}
                aria-label={
                  bitcoinAddresses.length > 0
                    ? 'Add Bitcoin address'
                    : 'Add a Bitcoin address'
                }
                style={connectButton}
              >
                {bitcoinAddresses.length > 0 ? 'Add' : 'Add address'}
              </button>
            </div>

            {bitcoinOpen ? (
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type='text'
                    aria-label='Bitcoin address'
                    placeholder='bc1q… or 1… or 3…'
                    value={addressInput}
                    spellCheck={false}
                    onChange={(event) => setAddressInput(event.target.value)}
                    style={addressInputStyle}
                  />
                  <button
                    type='button'
                    aria-label='Confirm Bitcoin address'
                    onClick={handleConfirm}
                    disabled={confirmDisabled}
                    title={
                      atCap
                        ? `Up to ${MAX_BITCOIN_ADDRESSES} addresses`
                        : addressInput.trim() === ''
                          ? 'Paste a Bitcoin address first'
                          : 'Read this address from the network'
                    }
                    style={{
                      ...confirmButton,
                      opacity: confirmDisabled ? 0.5 : 1,
                      cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <CheckGlyph />
                    {adding ? 'Reading…' : 'Confirm'}
                  </button>
                </div>

                {addError ? (
                  <div role='alert' style={errorText}>
                    {addError}
                  </div>
                ) : null}

                {atCap ? (
                  <div style={{ ...mutedNote, marginTop: '8px' }}>
                    Maximum of {MAX_BITCOIN_ADDRESSES} addresses reached.
                  </div>
                ) : null}

                <p style={{ ...mutedNote, marginTop: '10px' }}>
                  Bitcoin is read from the network: balances come from a public
                  source, are not proof of ownership, and cannot be verified by
                  a wallet signature.
                </p>

                <div style={{ marginTop: '6px' }}>
                  <Chip tone='warning' dot dotColor={BITCOIN_ORANGE}>
                    Read from the network
                  </Chip>
                </div>

                {bitcoinAddresses.map((record) => (
                  <div key={record.id} style={bitcoinRowStyle}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '10px',
                      }}
                    >
                      <span
                        title={record.address}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          fontSize: '12.5px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {record.address}
                      </span>
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {btc(record.btc)}
                      </span>
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {record.usd === null ? '—' : usd(record.usd)}
                      </span>
                      <button
                        type='button'
                        aria-label={`Remove address ${record.address}`}
                        onClick={() => onRemoveBitcoin(record.id)}
                        style={removeButton}
                      >
                        Remove
                      </button>
                    </div>
                    <div style={{ ...mutedNote, marginTop: '4px' }}>
                      Read from a public source — not proof of ownership.
                    </div>
                    {record.readError ? (
                      <div
                        role='alert'
                        style={{ ...errorText, marginTop: '4px' }}
                      >
                        {record.readError}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card padding='14px 16px'>
            <div style={rowHeaderStyle}>
              <span
                aria-hidden
                style={{ ...badgeStyle, background: tokens.ink }}
              >
                <EvmAddressGlyph size={22} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 600 }}>
                  Wallet address
                </div>
                <div style={rowSubtitleStyle}>
                  Paste a 0x address · reads balances
                </div>
              </div>
              {evmAddresses.length > 0 ? <ReadState /> : null}
              <button
                type='button'
                onClick={() => setEvmOpen((open) => !open)}
                aria-expanded={evmOpen}
                aria-label={
                  evmAddresses.length > 0
                    ? 'Add wallet address'
                    : 'Add a wallet address'
                }
                style={connectButton}
              >
                {evmAddresses.length > 0 ? 'Add' : 'Add address'}
              </button>
            </div>

            {evmOpen ? (
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type='text'
                    aria-label='Wallet address'
                    placeholder='0x…'
                    value={evmInput}
                    spellCheck={false}
                    onChange={(event) => setEvmInput(event.target.value)}
                    style={addressInputStyle}
                  />
                  <button
                    type='button'
                    aria-label='Confirm wallet address'
                    onClick={requestEvmAdd}
                    disabled={evmConfirmDisabled}
                    title={
                      evmAtCap
                        ? `Up to ${MAX_WALLET_ADDRESSES} addresses`
                        : evmInput.trim() === ''
                          ? 'Paste a 0x address first'
                          : 'Confirm this address before it is added'
                    }
                    style={{
                      ...confirmButton,
                      opacity: evmConfirmDisabled ? 0.5 : 1,
                      cursor: evmConfirmDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <CheckGlyph />
                    Confirm
                  </button>
                </div>

                {evmAtCap ? (
                  <div style={{ ...mutedNote, marginTop: '8px' }}>
                    Maximum of {MAX_WALLET_ADDRESSES} addresses reached.
                  </div>
                ) : null}

                <p style={{ ...mutedNote, marginTop: '10px' }}>
                  Balances are read from a public source on Ethereum and Base
                  and are not proof of ownership: no signature is asked for a
                  pasted address. You confirm each address before it is added,
                  and every saved address is listed in the Proof of wealth
                  summary on the right.
                </p>
              </div>
            ) : null}
          </Card>

          <div
            style={{
              border: `1px dashed ${tokens.border}`,
              borderRadius: '14px',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>
                Bank statement (optional)
              </div>
              <div style={rowSubtitleStyle}>
                For off-chain assets · PDF, hashed &amp; pinned
              </div>
            </div>
            <button type='button' style={connectButton}>
              Upload
            </button>
          </div>
        </div>

        <Card padding='20px 22px'>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={eyebrow}>Proof of wealth</div>
            <Chip tone='muted'>
              {hasRealRead ? 'Read from public sources' : 'No sources yet'}
            </Chip>
          </div>
          <div
            style={{
              marginTop: '10px',
              fontSize: '34px',
              fontWeight: 700,
              letterSpacing: '-.02em',
              color: total > 0 ? tokens.ink : tokens.locked,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {usd(total)}
          </div>
          <div
            style={{ fontSize: '13px', color: tokens.muted, marginTop: '4px' }}
          >
            {!hasRealRead
              ? 'Connect a wallet or add an address to begin'
              : [
                  summary.connectedCount > 0
                    ? `${summary.connectedCount} connected wallet${
                        summary.connectedCount === 1 ? '' : 's'
                      }`
                    : null,
                  summary.bitcoinCount > 0
                    ? `${summary.bitcoinCount} bitcoin address${
                        summary.bitcoinCount === 1 ? '' : 'es'
                      }`
                    : null,
                  summary.walletAddressCount > 0
                    ? `${summary.walletAddressCount} wallet address${
                        summary.walletAddressCount === 1 ? '' : 'es'
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </div>

          <div style={{ position: 'relative', marginTop: '18px' }}>
            <div style={trackStyle}>
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  borderRadius: '999px',
                  background: shortfall === 0 ? tokens.success : tokens.action,
                }}
              />
            </div>
            <span
              aria-hidden
              style={{ ...targetTickStyle, left: `calc(${targetMark}% - 1px)` }}
            />
          </div>

          <div style={targetRowStyle}>
            <span>Target · {tierName}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {usd(tierMinimum)}
            </span>
          </div>

          <div
            style={{
              marginTop: '12px',
              fontSize: '14px',
              fontWeight: 600,
              color: shortfall === 0 ? tokens.success : tokens.warning,
            }}
          >
            {shortfall === 0
              ? `${tierName} tier met`
              : `${usd(shortfall)} short of ${tierName} tier`}
          </div>

          {bitcoinAddresses.map((record) => (
            <div key={record.id} style={{ marginTop: '18px' }}>
              <div
                style={{
                  borderTop: `1px solid ${tokens.border}`,
                  paddingTop: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '14px', fontWeight: 600 }}>
                  Bitcoin · {btc(record.btc)}
                </span>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {record.usd === null ? '—' : usd(record.usd)}
                </span>
              </div>
              <div
                style={{
                  fontSize: '12.5px',
                  color: tokens.muted,
                  marginTop: '2px',
                }}
              >
                Read from the network · not proof of ownership
              </div>
            </div>
          ))}

          {evmAddresses.map((record) => (
            <div key={record.address} style={{ marginTop: '18px' }}>
              <div
                style={{
                  borderTop: `1px solid ${tokens.border}`,
                  paddingTop: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <span
                  title={record.address}
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  {shortAddress(record.address)}
                </span>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '12px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {record.usd === null ? '—' : usd(record.usd)}
                  </span>
                  <button
                    type='button'
                    aria-label={`Remove wallet address ${record.address}`}
                    onClick={() => onRemoveWalletAddress(record.address)}
                    style={removeButton}
                  >
                    Remove
                  </button>
                </span>
              </div>

              {record.chains.map((chain) => (
                <div
                  key={chain.chainId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                    fontSize: '13px',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '2px',
                      background: chainColor(chain.name),
                      flex: '0 0 auto',
                    }}
                  />
                  <span style={{ color: tokens.muted }}>
                    {chain.name} · {chain.nativeAmount} {chain.nativeSymbol}
                    {chain.usdc
                      ? ` · ${chain.usdc.amount} ${chain.usdc.symbol}`
                      : chain.tokenFailure
                        ? // The native read succeeded but the USDC sub-read did
                          // not: say so explicitly with `—` rather than silently
                          // omitting the token. The specific reason is carried on
                          // `record.readError` and named below, exactly as a
                          // whole-chain read failure is.
                          ' · USDC —'
                        : ''}
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontVariantNumeric: 'tabular-nums',
                      color: tokens.muted,
                    }}
                  >
                    {chain.usd === null ? '—' : usd(chain.usd)}
                  </span>
                </div>
              ))}

              <div
                style={{
                  fontSize: '12.5px',
                  color: tokens.muted,
                  marginTop: '6px',
                }}
              >
                Read from a public source · not proof of ownership
              </div>
              {record.readError ? (
                <div role='alert' style={{ ...errorText, marginTop: '4px' }}>
                  {record.readError}
                </div>
              ) : null}
            </div>
          ))}

          <p
            style={{
              margin: '18px 0 0',
              paddingTop: '14px',
              borderTop: `1px solid ${tokens.border}`,
              fontSize: '12.5px',
              color: tokens.muted,
              lineHeight: 1.6,
            }}
          >
            One signature covers every EVM chain — balances are read on
            Ethereum, Base, Arbitrum, Optimism and Celo. Bitcoin via watch-only
            xpub.
          </p>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
        <button type='button' onClick={onBack} style={secondaryButton}>
          Back
        </button>
        <button
          type='button'
          disabled={!canContinue}
          onClick={onContinue}
          title={
            canContinue
              ? 'Continue to the pre-approval fee'
              : 'Add a wallet or a Bitcoin address, or paste a wallet address, to continue'
          }
          style={{
            ...primaryButton,
            background: canContinue ? tokens.action : tokens.locked,
            cursor: canContinue ? 'pointer' : 'not-allowed',
          }}
        >
          Continue
        </button>
      </div>

      <Modal
        open={pendingEvm !== null}
        onClose={() => {
          if (!evmAdding) setPendingEvm(null);
        }}
        title='Add this address?'
      >
        <div style={{ padding: '6px 24px 20px' }}>
          <p
            style={{
              margin: '0 0 10px',
              fontSize: '13.5px',
              color: tokens.muted,
              lineHeight: 1.6,
            }}
          >
            Add this wallet address as a read-only proof-of-wealth source? Its
            balances are read from a public source on Ethereum and Base; pasting
            asks for no signature. You can verify it later from Holdings by
            connecting the wallet that controls it.
          </p>
          <div style={pendingAddressStyle}>{pendingEvm}</div>
          {evmError ? (
            <div role='alert' style={errorText}>
              {evmError}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end',
              marginTop: '18px',
            }}
          >
            <button
              type='button'
              onClick={() => setPendingEvm(null)}
              disabled={evmAdding}
              style={{ ...secondaryButton, opacity: evmAdding ? 0.5 : 1 }}
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={confirmEvmAdd}
              disabled={evmAdding}
              style={{
                ...primaryButton,
                background: tokens.action,
                cursor: evmAdding ? 'wait' : 'pointer',
                opacity: evmAdding ? 0.7 : 1,
              }}
            >
              {evmAdding ? 'Reading…' : 'Add address'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The state a watch-only row shows once an address is stored. Deliberately not
 * "Signed": no signature was produced for this row, and the balance was read
 * from a public source.
 */
function ReadState() {
  return (
    <span style={signedStyle}>
      <span style={signedDot} />
      Read
    </span>
  );
}

/** The green check that sits inside the Confirm button. */
function CheckGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox='0 0 24 24'
      fill='none'
      stroke={tokens.success}
      strokeWidth={3}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      focusable='false'
    >
      <path d='M4 12.5 9.5 18 20 6.5' />
    </svg>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const heading: React.CSSProperties = {
  margin: '8px 0 6px',
  fontSize: '30px',
  fontWeight: 700,
  letterSpacing: '-.02em',
};

const lead: React.CSSProperties = {
  margin: '0 0 24px',
  color: tokens.muted,
  maxWidth: '62ch',
  textWrap: 'pretty',
};

const rowHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const rowSubtitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: tokens.muted,
};

const badgeStyle: React.CSSProperties = {
  width: '38px',
  height: '38px',
  borderRadius: '10px',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '11px',
  fontWeight: 700,
  flex: '0 0 auto',
};

const signedStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '12.5px',
  fontWeight: 600,
  color: tokens.success,
  whiteSpace: 'nowrap',
};

const signedDot: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: tokens.success,
};

const connectButton: React.CSSProperties = {
  height: '36px',
  padding: '0 16px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  flex: '0 0 auto',
};

const addressInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '40px',
  padding: '0 12px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  background: '#fff',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '13px',
  color: tokens.ink,
  outline: 'none',
};

const confirmButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  height: '40px',
  padding: '0 16px',
  border: `1px solid ${tokens.success}`,
  borderRadius: '10px',
  background: '#fff',
  color: tokens.success,
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 700,
  flex: '0 0 auto',
};

const bitcoinRowStyle: React.CSSProperties = {
  marginTop: '10px',
  borderTop: `1px solid #F2D8B8`,
  paddingTop: '10px',
};

const removeButton: React.CSSProperties = {
  border: 0,
  background: 'transparent',
  color: tokens.action,
  fontFamily: 'inherit',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
  whiteSpace: 'nowrap',
};

/** The address shown in the add-confirmation dialog, in full and monospaced. */
const pendingAddressStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '13px',
  wordBreak: 'break-all',
  background: '#F8FAFC',
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  padding: '10px 12px',
  color: tokens.ink,
};

const mutedNote: React.CSSProperties = {
  fontSize: '11.5px',
  color: tokens.muted,
  lineHeight: 1.5,
  margin: 0,
};

const errorText: React.CSSProperties = {
  marginTop: '8px',
  fontSize: '12.5px',
  color: tokens.danger,
};

const trackStyle: React.CSSProperties = {
  height: '7px',
  borderRadius: '999px',
  background: tokens.border,
  overflow: 'hidden',
};

const targetTickStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-3px',
  width: '2px',
  height: '13px',
  background: tokens.ink,
};

const targetRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: '8px',
  fontSize: '13px',
  color: tokens.muted,
};

const primaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: 0,
  borderRadius: '999px',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
};

const secondaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};
