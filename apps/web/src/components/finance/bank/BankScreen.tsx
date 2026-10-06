'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import { tokens } from '@/components/ui/tokens';

/**
 * The Bank ↔ Crypto screen — a presentational divergence declared in
 * `docs/week-3-frozen-delivery-contract.md`.
 *
 * Finance is beyond the frozen Week 2 scope, so this screen creates no
 * capability: it has no server action, no Supabase read, no wallet/chain code,
 * and no network call. Every figure, reference, account and address below is a
 * value reproduced from the design handoff (`kade-mvp.dc.html`, the
 * "Bank ↔ Crypto" screen, and its Fund vault / Cash out dialogs); none of it is
 * a real account, transfer, balance or address. The two dialogs are local UI
 * state only: "Copy details & close" and "Review & sign transfer" simply close
 * the dialog and never claim a transfer happened.
 *
 * Laid out to match the reference's GOS screen (see the screenshot
 * `reference/design-handoff/screenshots/20-bank-crypto.png`): the header with the
 * "Powered by" + Girasol-logo call-out, the two direction cards, the three KPI
 * cards, and the transfer-history panel.
 */

const GRID = '.7fr 1fr 1.5fr 1fr 1fr 1fr';

const STRONG = '#101828';

/** The reference's demo GOS reference for this resident. */
const GOS_REFERENCE = 'OI-0409-MF';

const CHAINS = [
  { name: 'Ethereum', color: '#627EEA' },
  { name: 'Base', color: '#0052FF' },
  { name: 'Arbitrum', color: '#2D374B' },
] as const;

interface HistoryRow {
  readonly date: string;
  readonly dir: string;
  readonly dirColor: string;
  readonly what: string;
  readonly ref: string;
  readonly chain: string;
  readonly chainColor: string;
  readonly sent: string;
  readonly received: string;
  readonly status: string;
  readonly statusColor: string;
}

/** Demo transfer history, verbatim from the prototype's `gosHistory`. */
const HISTORY: readonly HistoryRow[] = [
  {
    date: '14 Sep',
    dir: 'Bank → Crypto',
    dirColor: '#0063B5',
    what: 'USD 15,000 · SWIFT',
    ref: 'GOS-9012',
    chain: 'Base',
    chainColor: '#0052FF',
    sent: '$15,000',
    received: 'pending',
    status: 'In progress',
    statusColor: tokens.warning,
  },
  {
    date: '02 Sep',
    dir: 'Bank → Crypto',
    dirColor: '#0063B5',
    what: 'EUR 22,000 · Commerzbank',
    ref: 'GOS-8841',
    chain: 'Ethereum',
    chainColor: '#627EEA',
    sent: '€22,000',
    received: '23,795 USDC',
    status: 'Credited',
    statusColor: tokens.success,
  },
  {
    date: '28 Aug',
    dir: 'Crypto → Bank',
    dirColor: tokens.warning,
    what: 'Payout to Vidanova ···8845',
    ref: 'GOS-8703',
    chain: 'Arbitrum',
    chainColor: '#2D374B',
    sent: '4,200 USDC',
    received: 'XCG 7,500',
    status: 'Settled',
    statusColor: tokens.success,
  },
  {
    date: '21 Aug',
    dir: 'Bank → Crypto',
    dirColor: '#0063B5',
    what: 'USD 25,000 · JPMorgan wire',
    ref: 'GOS-8620',
    chain: 'Ethereum',
    chainColor: '#627EEA',
    sent: '$25,000',
    received: '24,875 USDC',
    status: 'Credited',
    statusColor: tokens.success,
  },
  {
    date: '09 Aug',
    dir: 'Bank → Crypto',
    dirColor: '#0063B5',
    what: 'EUR 13,000 · SEPA instant',
    ref: 'GOS-8455',
    chain: 'Ethereum',
    chainColor: '#627EEA',
    sent: '€13,000',
    received: '14,062 USDC',
    status: 'Credited',
    statusColor: tokens.success,
  },
];

interface LedgerRow {
  readonly what: string;
  readonly date: string;
  readonly ref: string;
  readonly received: string;
  readonly status: string;
  readonly color: string;
}

/** Demo recent top-ups, from the prototype's `fundHistory`. */
const TOP_UPS: readonly LedgerRow[] = [
  {
    what: 'EUR 22,000 · Commerzbank',
    date: '02 Sep',
    ref: 'GOS-8841',
    received: '+ 23,795 USDC',
    status: 'Credited',
    color: tokens.success,
  },
  {
    what: 'USD 25,000 · JPMorgan wire',
    date: '21 Aug',
    ref: 'GOS-8620',
    received: '+ 24,875 USDC',
    status: 'Credited',
    color: tokens.success,
  },
  {
    what: 'USD 15,000 · SWIFT in transit',
    date: '14 Sep',
    ref: 'GOS-9012',
    received: 'pending',
    status: 'In progress',
    color: tokens.warning,
  },
];

/** Demo recent payouts, from the prototype's `cashHistory`. */
const PAYOUTS: readonly LedgerRow[] = [
  {
    what: 'XCG 7,500 · Vidanova ···8845',
    date: '28 Aug',
    ref: 'GOS-8703',
    received: '− 4,200 USDC',
    status: 'Settled',
    color: tokens.success,
  },
];

const CURRENCIES = ['USD', 'EUR', 'XCG'] as const;
type Currency = (typeof CURRENCIES)[number];

interface CurrencyDetails {
  readonly accountLabel: string;
  readonly account: string;
  readonly bicLabel: string;
  readonly bic: string;
  readonly bank: string;
  readonly eta: string;
}

/** Demo GOS funding details per currency, from the prototype's `fund*` values. */
const CURRENCY_DETAILS: Record<Currency, CurrencyDetails> = {
  USD: {
    accountLabel: 'Account',
    account: '8813 4420 7719',
    bicLabel: 'Routing',
    bic: '021000021',
    bank: 'JPMorgan Chase · New York',
    eta: 'ACH 1 day · wire same day',
  },
  EUR: {
    accountLabel: 'IBAN',
    account: 'NL42 GOSP 0417 8821 30',
    bicLabel: 'BIC',
    bic: 'GOSPNL2A',
    bank: 'GOS Payments · Amsterdam',
    eta: 'SEPA instant · minutes',
  },
  XCG: {
    accountLabel: 'Account',
    account: 'CW17 VIDA 0044 2281 90',
    bicLabel: 'BIC',
    bic: 'VIDACW22',
    bank: 'Vidanova Bank · Willemstad',
    eta: 'local transfer · same day',
  },
};

const EYEBROW: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const META_ROW: CSSProperties = {
  display: 'flex',
  gap: '16px',
  marginTop: '14px',
  fontSize: '12.5px',
  color: tokens.muted,
  flexWrap: 'wrap',
};

const SUMMARY: CSSProperties = {
  marginTop: '16px',
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontSize: '13px',
};

const SUMMARY_ROW: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
};

const INPUT_LABEL: CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: tokens.muted,
  marginBottom: '6px',
};

/** One chain pill in the reference's bordered, selectable chain group. */
function ChainPills({
  selected,
  onSelect,
}: {
  readonly selected: string;
  readonly onSelect: (name: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {CHAINS.map((chain) => {
        const active = chain.name === selected;
        return (
          <button
            key={chain.name}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(chain.name)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 10px',
              border: `1.5px solid ${active ? tokens.action : tokens.border}`,
              borderRadius: '999px',
              background: '#fff',
              fontFamily: 'inherit',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              color: tokens.ink,
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '2px',
                background: chain.color,
                flex: '0 0 auto',
              }}
            />
            {chain.name}
          </button>
        );
      })}
    </div>
  );
}

/** The Fund vault dialog: a visual mock of the reference's GOS top-up panel. */
function FundVaultModal({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [chain, setChain] = useState<string>('Ethereum');
  const details = CURRENCY_DETAILS[currency];

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Fund your vault"
      title="Send from your bank via GOS"
      maxWidth={460}
    >
      <div style={{ padding: '22px' }}>
        <div
          style={{
            display: 'flex',
            gap: '6px',
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: '999px',
            padding: '4px',
            width: 'fit-content',
          }}
        >
          {CURRENCIES.map((option) => {
            const active = option === currency;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => setCurrency(option)}
                style={{
                  padding: '7px 14px',
                  border: 0,
                  borderRadius: '999px',
                  fontFamily: 'inherit',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? tokens.ink : 'transparent',
                  color: active ? '#fff' : tokens.chipFg,
                }}
              >
                {option}
              </button>
            );
          })}
        </div>

        <div style={{ ...EYEBROW, marginTop: '16px' }}>
          Send to these details
        </div>
        <div
          style={{
            marginTop: '8px',
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: '12px',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '9px',
            fontSize: '13px',
          }}
        >
          <DetailRow label="Beneficiary">
            GOS Payments B.V. (for Marcus Feldt)
          </DetailRow>
          <DetailRow label={details.accountLabel}>
            <span
              style={{ fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all' }}
            >
              {details.account}
            </span>
          </DetailRow>
          <DetailRow label={details.bicLabel}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {details.bic}
            </span>
          </DetailRow>
          <DetailRow label="Bank">{details.bank}</DetailRow>
          <DetailRow label="Reference">
            <span
              style={{
                fontWeight: 700,
                color: tokens.brandPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {GOS_REFERENCE}
            </span>
          </DetailRow>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '96px 1fr',
              gap: '12px',
              alignItems: 'center',
            }}
          >
            <span style={{ color: tokens.muted }}>Credit to</span>
            <ChainPills selected={chain} onSelect={setChain} />
          </div>
        </div>

        <div
          style={{
            marginTop: '12px',
            background: tokens.activeNavBg,
            borderRadius: '10px',
            padding: '11px 13px',
            fontSize: '12.5px',
            color: tokens.brandPrimary,
          }}
        >
          Always include the reference — it routes the transfer to your vault
          automatically.
        </div>

        <div
          style={{
            marginTop: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontSize: '13px',
          }}
        >
          <div style={SUMMARY_ROW}>
            <span style={{ color: tokens.muted }}>Credited as</span>
            <span style={{ fontWeight: 600 }}>
              USDC in Safe 0x5Af1…c09D · {chain}
            </span>
          </div>
          <div style={SUMMARY_ROW}>
            <span style={{ color: tokens.muted }}>GOS fee</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>0.5%</span>
          </div>
          <div style={SUMMARY_ROW}>
            <span style={{ color: tokens.muted }}>Arrives</span>
            <span>{details.eta}</span>
          </div>
          <div
            style={{
              fontSize: '11.5px',
              color: tokens.muted,
              lineHeight: 1.6,
              marginTop: '2px',
            }}
          >
            {chain === 'Ethereum'
              ? 'Settles directly on Ethereum — our on/off-ramp network.'
              : `Settles on Ethereum first, then bridges to ${chain} automatically · ~2 min, no extra fee.`}
          </div>
        </div>

        <div style={{ ...EYEBROW, marginTop: '16px' }}>Recent top-ups</div>
        <div style={{ marginTop: '4px' }}>
          {TOP_UPS.map((topUp) => (
            <LedgerRowView key={topUp.ref} row={topUp} />
          ))}
        </div>

        <Button
          fullWidth
          onClick={onClose}
          style={{ height: '44px', fontSize: '14.5px', marginTop: '18px' }}
        >
          Copy details &amp; close
        </Button>
      </div>
    </Modal>
  );
}

/** The Cash out dialog: a visual mock of the reference's send panel. */
function CashOutModal({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const [amount, setAmount] = useState('5000');
  const [name, setName] = useState('Marcus Feldt');
  const [iban, setIban] = useState('DE89 3704 0044 0532 0130 00');
  const [chain, setChain] = useState<string>('Ethereum');

  const numeric = Number(amount);
  const valid = Number.isFinite(numeric) && numeric > 0;
  const fee = valid ? `$${Math.round(numeric * 0.01).toLocaleString('en-US')}` : '—';
  const receives = valid
    ? `€${Math.round(numeric * 0.92 * 0.99).toLocaleString('en-US')}`
    : '—';

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Cash out"
      title="Vault USDC → bank account"
      maxWidth={440}
    >
      <div style={{ padding: '22px' }}>
        <div>
          <label htmlFor="cash-out-amount" style={INPUT_LABEL}>
            Amount (USDC from vault)
          </label>
          <input
            id="cash-out-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            spellCheck={false}
            onChange={(event) => setAmount(event.target.value)}
            style={{
              width: '100%',
              height: '48px',
              border: `1px solid ${tokens.border}`,
              borderRadius: '12px',
              padding: '0 14px',
              fontSize: '20px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'inherit',
              background: '#fff',
              color: tokens.ink,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ marginTop: '14px' }}>
          <label htmlFor="cash-out-name" style={INPUT_LABEL}>
            Beneficiary name
          </label>
          <input
            id="cash-out-name"
            type="text"
            value={name}
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            style={{
              width: '100%',
              height: '42px',
              border: `1px solid ${tokens.border}`,
              borderRadius: '10px',
              padding: '0 14px',
              fontSize: '14px',
              fontFamily: 'inherit',
              background: '#fff',
              color: tokens.ink,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ marginTop: '14px' }}>
          <label htmlFor="cash-out-iban" style={INPUT_LABEL}>
            IBAN
          </label>
          <input
            id="cash-out-iban"
            type="text"
            value={iban}
            spellCheck={false}
            onChange={(event) => setIban(event.target.value)}
            style={{
              width: '100%',
              height: '42px',
              border: `1px solid ${tokens.border}`,
              borderRadius: '10px',
              padding: '0 14px',
              fontSize: '14px',
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'inherit',
              background: '#fff',
              color: tokens.ink,
              outline: 'none',
            }}
          />
        </div>

        <div style={SUMMARY}>
          <div style={SUMMARY_ROW}>
            <span style={{ color: tokens.muted }}>GOS fee 1%</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fee}</span>
          </div>
          <div style={SUMMARY_ROW}>
            <span style={{ color: tokens.muted }}>Beneficiary receives</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {receives}
            </span>
          </div>
          <div style={{ ...SUMMARY_ROW, alignItems: 'center' }}>
            <span style={{ color: tokens.muted }}>Debit from</span>
            <ChainPills selected={chain} onSelect={setChain} />
          </div>
          <div style={SUMMARY_ROW}>
            <span style={{ color: tokens.muted }}>Arrives</span>
            <span>SEPA instant · minutes</span>
          </div>
          <div
            style={{
              fontSize: '11.5px',
              color: tokens.muted,
              lineHeight: 1.6,
              marginTop: '2px',
            }}
          >
            {chain === 'Ethereum'
              ? 'Paid straight from the Ethereum vault — our on/off-ramp network.'
              : `Bridged from ${chain} to Ethereum for settlement · ~2 min, included in the 1% fee.`}
          </div>
        </div>

        <div
          style={{
            marginTop: '14px',
            background: '#FDF6E7',
            borderRadius: '10px',
            padding: '11px 13px',
            fontSize: '12.5px',
            color: '#8A5A12',
          }}
        >
          Bank payouts unlock once intake review completes.
        </div>

        <Button
          fullWidth
          onClick={onClose}
          style={{ height: '44px', fontSize: '14.5px', marginTop: '18px' }}
        >
          Review &amp; sign transfer
        </Button>

        <div style={{ ...EYEBROW, marginTop: '14px' }}>Recent payouts</div>
        <div>
          {PAYOUTS.map((payout) => (
            <LedgerRowView key={payout.ref} row={payout} />
          ))}
        </div>

        <div
          style={{
            marginTop: '12px',
            fontSize: '11.5px',
            color: tokens.muted,
            textAlign: 'center',
          }}
        >
          One Safe signature · GOS converts and settles to the account.
        </div>
      </div>
    </Modal>
  );
}

/** One label/value row in the fund dialog's details block. */
function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '96px 1fr',
        gap: '12px',
      }}
    >
      <span style={{ color: tokens.muted }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{children}</span>
    </div>
  );
}

/** One row in a modal's recent-activity list. */
function LedgerRowView({ row }: { readonly row: LedgerRow }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: '10px',
        padding: '9px 0',
        borderTop: `1px solid ${tokens.border}`,
        fontSize: '12.5px',
        alignItems: 'center',
      }}
    >
      <div>
        <div style={{ fontWeight: 500 }}>{row.what}</div>
        <div
          style={{
            fontSize: '11.5px',
            color: tokens.muted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {row.date} · {row.ref}
        </div>
      </div>
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {row.received}
      </span>
      <span
        style={{
          fontSize: '11.5px',
          fontWeight: 600,
          color: row.color,
          whiteSpace: 'nowrap',
        }}
      >
        {row.status}
      </span>
    </div>
  );
}

export function BankScreen() {
  const [fundOpen, setFundOpen] = useState(false);
  const [cashOutOpen, setCashOutOpen] = useState(false);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '24px',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '36px',
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: '-.02em',
            }}
          >
            Bank ↔ Crypto
          </h1>
          <p
            style={{
              margin: '10px 0 0',
              color: tokens.muted,
              maxWidth: '62ch',
              textWrap: 'pretty',
            }}
          >
            Fund your vault from a bank account, or offramp into your bank.
          </p>
        </div>
        <a
          href="https://www.girasolpayments.com/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: tokens.activeNavBg,
            color: tokens.brandPrimary,
            fontSize: '11px',
            fontWeight: 700,
            // Symmetric horizontal padding keeps the pill balanced around the
            // text + logo contents.
            padding: '5px 10px',
            borderRadius: '999px',
            whiteSpace: 'nowrap',
            textDecoration: 'none',
          }}
        >
          Powered by
          {/*
            The asset is now cropped tight around the wordmark's ink, so 263×84
            is its true intrinsic size (it was 300×100 with asymmetric
            transparent padding: top 6, bottom 18, left 19, right 26).
          */}
          <Image
            src="/girasol-logo.png"
            alt="Girasol"
            width={263}
            height={84}
            style={{
              // Size the Girasol mark to the label's cap height: the mark's ink
              // is 44px tall in the 84px canvas, so at height 15 it renders at
              // ~7.9px, matching the ~8px cap height of the 11px bold label.
              height: 15,
              width: 'auto',
              display: 'block',
              // Optical centring. Measured on the 263×84 asset: the wordmark's
              // x-height band (source rows 26–63) centres ~1px below the ink
              // bbox centre, and the alpha-weighted centroid ~1.5px below it,
              // because the "g" descender loop carries more ink than the "l"
              // ascender. With the box centred the body therefore reads a
              // fraction low beside "Powered by"; the residual is ~0.2–0.3px
              // at this render size, applied as a half-pixel upward nudge.
              transform: 'translateY(-0.5px)',
            }}
          />
        </a>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            background: '#fff',
            border: `1px solid ${tokens.action}`,
            borderRadius: '14px',
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            data-testid="bank-direction-bank-crypto"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: tokens.action,
            }}
          >
            Bank → Crypto
          </div>
          <h2
            style={{
              margin: '8px 0 6px',
              fontSize: '22px',
              fontWeight: 700,
              letterSpacing: '-.01em',
            }}
          >
            Fund your vault
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '13.5px',
              color: tokens.chipFg,
              textWrap: 'pretty',
            }}
          >
            Send USD, EUR or XCG from your bank to your GOS funding account. It
            settles on Ethereum, then lands as USDC in your vault on the chain
            you choose — and counts toward your permit.
          </p>
          <div style={META_ROW}>
            <span>
              <strong style={{ color: STRONG }}>
                SEPA · SWIFT · ACH · local XCG
              </strong>
            </span>
            <span>
              <strong style={{ color: STRONG }}>0.5%</strong> fee
            </span>
            <span>
              credited on{' '}
              <strong style={{ color: STRONG }}>
                Ethereum, Base or Arbitrum
              </strong>
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <Button
            fullWidth
            onClick={() => setFundOpen(true)}
            style={{ height: '44px', fontSize: '14.5px', marginTop: '18px' }}
          >
            Fund vault
          </Button>
        </div>

        <div
          style={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: '14px',
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            opacity: 0.75,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '12px',
            }}
          >
            <div
              data-testid="bank-direction-crypto-bank"
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: tokens.muted,
              }}
            >
              Crypto → Bank
            </div>
            <Chip tone="warning" dot>
              After review
            </Chip>
          </div>
          <h2
            style={{
              margin: '8px 0 6px',
              fontSize: '22px',
              fontWeight: 700,
              letterSpacing: '-.01em',
            }}
          >
            Cash out
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '13.5px',
              color: tokens.chipFg,
              textWrap: 'pretty',
            }}
          >
            Send USDC from any vault chain to a bank account in XCG, EUR or USD.
            We bridge to Ethereum for settlement; unlocked funds only, your
            qualifying balance stays intact.
          </p>
          <div style={META_ROW}>
            <span>
              <strong style={{ color: STRONG }}>XCG · EUR · USD</strong> payout
            </span>
            <span>
              <strong style={{ color: STRONG }}>1%</strong> fee · same day
            </span>
            <span>
              debit from <strong style={{ color: STRONG }}>any vault chain</strong>
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <Button
            fullWidth
            variant="secondary"
            onClick={() => setCashOutOpen(true)}
            style={{
              height: '44px',
              fontSize: '14.5px',
              marginTop: '18px',
              background: '#fff',
              color: STRONG,
              border: `1px solid ${STRONG}`,
              cursor: 'not-allowed',
            }}
          >
            Unlocks after review
          </Button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)',
          gap: '14px',
          marginBottom: '16px',
        }}
      >
        <div data-testid="bank-kpi-funded">
          <StatCard
            label="Funded in"
            value="$62,500"
            sub="3 transfers · last 90 days"
          />
        </div>
        <div data-testid="bank-kpi-cashed">
          <StatCard label="Cashed out" value="$4,200" sub="1 payout · XCG" />
        </div>
        <div data-testid="bank-kpi-progress">
          <StatCard
            label="In progress"
            value="$15,000"
            valueColor={tokens.warning}
            sub="SWIFT · expected 16 Sep"
          />
        </div>
      </div>

      <div
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: '14px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '18px 22px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '16px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
            Transfer history
          </h2>
          <span
            style={{ fontSize: '12px', color: tokens.muted, whiteSpace: 'nowrap' }}
          >
            GOS reference · onchain settlement
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID,
            gap: '12px',
            padding: '10px 22px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: tokens.muted,
            borderTop: `1px solid ${tokens.border}`,
            borderBottom: `1px solid ${tokens.border}`,
          }}
        >
          <span>Date</span>
          <span>Direction</span>
          <span>Detail</span>
          <span style={{ textAlign: 'right' }}>Sent</span>
          <span style={{ textAlign: 'right' }}>Received</span>
          <span>Status</span>
        </div>

        {HISTORY.map((row) => (
          <div
            key={row.ref}
            data-testid={`bank-history-${row.ref}`}
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              gap: '12px',
              padding: '12px 22px',
              fontSize: '13.5px',
              borderBottom: `1px solid ${tokens.border}`,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                color: tokens.muted,
                fontSize: '12.5px',
                whiteSpace: 'nowrap',
              }}
            >
              {row.date}
            </span>
            <span
              style={{
                fontWeight: 600,
                fontSize: '12.5px',
                whiteSpace: 'nowrap',
                color: row.dirColor,
              }}
            >
              {row.dir}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {row.what}
              </div>
              <div
                style={{
                  fontSize: '11.5px',
                  color: tokens.muted,
                  fontVariantNumeric: 'tabular-nums',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '2px',
                    background: row.chainColor,
                    flex: '0 0 auto',
                  }}
                />
                {row.ref} · {row.chain}
              </div>
            </div>
            <span
              style={{
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                color: tokens.muted,
              }}
            >
              {row.sent}
            </span>
            <span
              style={{
                textAlign: 'right',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {row.received}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: row.statusColor,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: row.statusColor,
                }}
              />
              {row.status}
            </span>
          </div>
        ))}

        <div
          style={{
            padding: '13px 22px',
            fontSize: '12.5px',
            color: tokens.muted,
          }}
        >
          Fiat legs settle on Ethereum — our on/off-ramp network — and are
          bridged to or from your chosen vault chain in the same action. Deposits
          and yield positions can live on Ethereum, Base or Arbitrum; each credit
          is a Safe transaction you can verify.
        </div>
      </div>

      <FundVaultModal open={fundOpen} onClose={() => setFundOpen(false)} />
      <CashOutModal open={cashOutOpen} onClose={() => setCashOutOpen(false)} />
    </div>
  );
}
