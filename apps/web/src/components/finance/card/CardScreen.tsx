'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import { CardTopUpModal } from './CardTopUpModal';
import { CardVisual } from './CardVisual';

/**
 * Card & Banking (D21) — a **declared presentational mock**.
 *
 * Finance is beyond the frozen Week 2 scope (week-2 contract §2.1), so this
 * screen exists only to make the design handoff explorable. Every figure below
 * is a seed demo value; nothing here reads a chain, calls a server action,
 * moves funds or orders a card.
 *
 * The default render is the reference's pre-order / in-review state
 * (kade-mvp.dc.html 615–633; screenshot 22). The "Order card" control advances
 * to the active state (kade-mvp.dc.html 559–612; screenshot 23) — a deliberate
 * **mock affordance** for exploring the reference, because the live prototype
 * gates ordering on intake review (`orderCard: () => { if (!inReview) … }`).
 */

/** Seed demo values — not real balances, limits or transactions. */
const HOW_IT_WORKS = [
  'Spend anywhere on the island — merchants are charged in XCG.',
  'USDC is debited from your vault at the CBCS peg, 1.79 XCG to the dollar, with no card fee.',
  'Your spend limit is set onchain and your qualifying balance never dips below tier.',
] as const;

/** Seed demo values — not real transactions. */
interface CardTransaction {
  readonly date: string;
  readonly who: string;
  readonly meta: string;
  readonly xcg: string;
  readonly usdc: string;
  /** A credit, rendered in the reference's green. */
  readonly positive?: boolean;
}

const TRANSACTIONS: readonly CardTransaction[] = [
  {
    date: '14 Sep',
    who: 'Van den Tweel Supermarket',
    meta: 'Groceries · Willemstad',
    xcg: '− 214.40',
    usdc: '− 119.78',
  },
  {
    date: '13 Sep',
    who: 'Aqualectra',
    meta: 'Utilities · direct debit',
    xcg: '− 410.00',
    usdc: '− 229.05',
  },
  {
    date: '12 Sep',
    who: 'Top-up from vault',
    meta: 'USDC → spending balance',
    xcg: '+ 3,580.00',
    usdc: '+ 2,000.00',
    positive: true,
  },
  {
    date: '11 Sep',
    who: 'Kome Restaurant',
    meta: 'Dining · Pietermaai',
    xcg: '− 186.50',
    usdc: '− 104.19',
  },
  {
    date: '10 Sep',
    who: 'Curaçao Airport Duty Free',
    meta: 'Retail · Hato',
    xcg: '− 92.75',
    usdc: '− 51.82',
  },
  {
    date: '08 Sep',
    who: 'International School of Curaçao',
    meta: 'Tuition instalment',
    xcg: '− 1,835.00',
    usdc: '− 1,025.14',
  },
  {
    date: '06 Sep',
    who: 'Blue Bay Golf',
    meta: 'Leisure',
    xcg: '− 148.00',
    usdc: '− 82.68',
  },
  {
    date: '04 Sep',
    who: 'Mangusá Supermarket',
    meta: 'Groceries · Salinja',
    xcg: '− 300.60',
    usdc: '− 167.93',
  },
];

/** Seed demo values — the month's spend split. */
const SPEND_SPLIT = [
  { label: 'Groceries XCG 1,084', color: '#0063B5', width: '34%' },
  { label: 'Dining XCG 861', color: '#0A7CFF', width: '27%' },
  { label: 'Utilities XCG 701', color: '#89C2FF', width: '22%' },
  { label: 'Other XCG 541', color: '#C2DEFF', width: '17%' },
] as const;

const TX_COLUMNS = '.6fr 1.6fr 1fr 1fr';

/** The amber demo disclosure, the first element of the screen. */
const demoNotice = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  background: '#FDF6E7',
  border: '1px solid #F2E3C0',
  borderRadius: '12px',
  padding: '12px 14px',
  fontSize: '12.5px',
  color: '#8A5A12',
  marginBottom: '20px',
} as const;

const demoNoticeDot = {
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  background: '#B7791F',
  flex: '0 0 auto',
  marginTop: '5px',
} as const;

export function CardScreen() {
  // Mock-only state. `activePreview` switches the pre-order layout to the
  // active layout for exploration; it is not a real card order.
  const [activePreview, setActivePreview] = useState(false);
  const [slashApplied, setSlashApplied] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);

  return (
    <div style={{ maxWidth: '1160px', width: '100%', margin: '0 auto' }}>
      {/*
        The disclosure is the first thing on the screen so a resident cannot
        mistake the mock for their own records before scrolling.
      */}
      <div role="note" style={demoNotice}>
        <span style={demoNoticeDot} />
        <span>
          <strong>Preview · demo data.</strong> This screen is a visual mock.
          The balances, transactions, card and addresses shown are illustrative
          examples, not real records — no funds move, and none of the addresses
          should be used.
        </span>
      </div>

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
            Onchain Island Card
          </h1>
          <p
            style={{
              margin: '10px 0 0',
              color: tokens.muted,
              maxWidth: '62ch',
              textWrap: 'pretty',
            }}
          >
            Spend from your vault in XCG anywhere on the island. Ordering
            unlocks once intake review completes.
          </p>
        </div>
        <Chip tone="muted" dot>
          Unlocks after review
        </Chip>
      </div>

      {activePreview ? (
        <ActiveLayout onTopUp={() => setTopupOpen(true)} />
      ) : (
        <PreOrderLayout onPreview={() => setActivePreview(true)} />
      )}

      <AltitudeBanner
        applied={slashApplied}
        onApply={() => setSlashApplied(true)}
      />

      <CardTopUpModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
      />
    </div>
  );
}

/** The reference's pre-order / in-review layout (kade-mvp.dc.html 615–633). */
function PreOrderLayout({ onPreview }: { readonly onPreview: () => void }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)',
        gap: '16px',
        alignItems: 'start',
        marginBottom: '16px',
      }}
    >
      <Card radius={14}>
        <CardVisual number="•••• •••• •••• ••••" expiry="VISA" opacity={0.9} />
        {/*
          The reference's gated button is genuinely disabled: ordering is gated
          on intake review, so it must not be interactive. The active layout is
          reachable through the separately labelled demo-preview control below,
          which never claims a real order.
        */}
        <Button
          variant="locked"
          fullWidth
          disabled
          style={{ marginTop: '16px', height: '44px', fontSize: '14px' }}
        >
          Order card · after intake review
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onClick={onPreview}
          style={{ marginTop: '8px', height: '36px', fontSize: '12.5px' }}
        >
          Preview active card (demo)
        </Button>
      </Card>

      <Card radius={14}>
        <h2 style={{ margin: '0 0 12px', fontSize: '17px', fontWeight: 600 }}>
          How it works
        </h2>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            fontSize: '13.5px',
            color: '#344054',
            lineHeight: 1.5,
          }}
        >
          {HOW_IT_WORKS.map((text, index) => (
            <div
              key={text}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr',
                gap: '10px',
              }}
            >
              <span style={{ color: tokens.action, fontWeight: 700 }}>
                {index + 1}
              </span>
              <span>{text}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: '16px',
            background: '#fff',
            border: `1px solid ${tokens.border}`,
            borderRadius: '10px',
            padding: '12px 14px',
            fontSize: '12.5px',
            color: tokens.muted,
          }}
        >
          Issued by GOS · Visa debit · Apple Pay and Google Pay on issue ·
          arrives in 5 working days.
        </div>
      </Card>
    </div>
  );
}

/** The reference's active layout (kade-mvp.dc.html 559–612). */
function ActiveLayout({ onTopUp }: { readonly onTopUp: () => void }) {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4,1fr)',
          gap: '14px',
          marginBottom: '16px',
        }}
      >
        <Kpi label="Available" value="XCG 8,946" sub="$4,997" />
        <Kpi label="Spent · Sep" value="XCG 3,187" sub="$1,781 · 14 tx" />
        <Kpi label="Monthly limit" value="XCG 9,000">
          <div
            style={{
              position: 'relative',
              height: '6px',
              borderRadius: '999px',
              background: tokens.border,
              marginTop: '10px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                borderRadius: '999px',
                background: tokens.brandPrimary,
                width: '35%',
              }}
            />
          </div>
        </Kpi>
        <Kpi label="Rate · fees" value="1.79" sub="XCG/USD · 0% fee" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.5fr)',
          gap: '16px',
          alignItems: 'start',
          marginBottom: '16px',
        }}
      >
        <Card radius={14}>
          <CardVisual number="•••• •••• •••• 4821" expiry="VISA · 09/30" />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
              marginTop: '16px',
            }}
          >
            <InfoTile label="Status" value="Active" tone={tokens.success} />
            <InfoTile label="Funding" value="Vault USDC" />
            <InfoTile label="Delivered" value="12 Sep 2026" />
            <InfoTile label="Apple / Google Pay" value="Added" />
          </div>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginTop: '14px',
              flexWrap: 'wrap',
            }}
          >
            <Button
              onClick={onTopUp}
              style={{ height: '36px', padding: '0 14px', fontSize: '12.5px' }}
            >
              Top up
            </Button>
            <Button
              variant="secondary"
              style={{ height: '36px', padding: '0 14px', fontSize: '12.5px' }}
            >
              Set limit
            </Button>
            <Button
              variant="secondary"
              style={{
                height: '36px',
                padding: '0 14px',
                fontSize: '12.5px',
                color: tokens.danger,
              }}
            >
              Freeze
            </Button>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Card radius={14} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px 12px' }}>
              <h2
                style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}
              >
                Transactions
              </h2>
              <div
                style={{
                  fontSize: '12px',
                  color: tokens.muted,
                  marginTop: '3px',
                  whiteSpace: 'nowrap',
                }}
              >
                September 2026 · XCG charged, USDC debited
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: TX_COLUMNS,
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
              <span>Merchant</span>
              <span style={{ textAlign: 'right' }}>XCG</span>
              <span style={{ textAlign: 'right' }}>USDC</span>
            </div>
            {TRANSACTIONS.map((tx) => (
              <div
                key={`${tx.date}-${tx.who}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: TX_COLUMNS,
                  gap: '12px',
                  padding: '11px 22px',
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
                  {tx.date}
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
                    {tx.who}
                  </div>
                  <div style={{ fontSize: '11.5px', color: tokens.muted }}>
                    {tx.meta}
                  </div>
                </div>
                <span
                  style={{
                    textAlign: 'right',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: tx.positive ? tokens.success : tokens.ink,
                  }}
                >
                  {tx.xcg}
                </span>
                <span
                  style={{
                    textAlign: 'right',
                    color: tokens.muted,
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: '12.5px',
                  }}
                >
                  {tx.usdc}
                </span>
              </div>
            ))}
          </Card>

          <Card radius={14} padding="20px 24px">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                Where it goes
              </h2>
              <span style={{ fontSize: '12px', color: tokens.muted }}>
                XCG 3,187 this month
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '3px',
                marginTop: '14px',
                height: '10px',
                borderRadius: '999px',
                overflow: 'hidden',
              }}
            >
              {SPEND_SPLIT.map((segment) => (
                <span
                  key={segment.label}
                  style={{ background: segment.color, width: segment.width }}
                />
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                gap: '16px',
                flexWrap: 'wrap',
                marginTop: '12px',
                fontSize: '12px',
                color: tokens.muted,
              }}
            >
              {SPEND_SPLIT.map((segment) => (
                <span
                  key={segment.label}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '2px',
                      background: segment.color,
                    }}
                  />
                  {segment.label}
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  sub,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly children?: ReactNode;
}) {
  return (
    <Card radius={14} padding="18px 20px">
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: tokens.muted,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '26px',
          fontWeight: 700,
          marginTop: '8px',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
      {sub ? (
        <div
          style={{
            fontSize: '12.5px',
            color: tokens.muted,
            marginTop: '2px',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {sub}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

function InfoTile({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${tokens.border}`,
        borderRadius: '10px',
        padding: '11px 13px',
      }}
    >
      <div style={{ fontSize: '11px', color: tokens.muted }}>{label}</div>
      <div
        style={{
          fontSize: '13.5px',
          fontWeight: 600,
          marginTop: '2px',
          color: tone,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** The "Altitude banking" banner, shown in both states (615–643). */
function AltitudeBanner({
  applied,
  onApply,
}: {
  readonly applied: boolean;
  readonly onApply: () => void;
}) {
  return (
    <Card
      radius={14}
      padding="20px 24px"
      style={{
        border: '1px dashed #C6D2E0',
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) auto',
        gap: '24px',
        alignItems: 'center',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>
            Altitude banking
          </h2>
          <Chip tone="warning" dot>
            Coming later
          </Chip>
        </div>
        <div
          style={{
            fontSize: '13.5px',
            color: '#344054',
            marginTop: '8px',
            textWrap: 'pretty',
          }}
        >
          Full USD and entity accounts connected to your Onchain Island
          identity — salary, rent, invoices and your Curaçao B.V., mirrored
          into this platform. Verified residents get priority.
        </div>
      </div>
      <div
        style={{ fontSize: '12.5px', color: tokens.muted, lineHeight: 1.7 }}
      >
        USD account · Entity accounts
        <br />
        Treasury yield on idle cash · Vault sync
      </div>
      <Button
        variant="secondary"
        onClick={onApply}
        style={{
          height: '42px',
          padding: '0 20px',
          fontSize: '14px',
          whiteSpace: 'nowrap',
          ...(applied
            ? {
                background: tokens.ink,
                color: '#fff',
                border: `1px solid ${tokens.ink}`,
              }
            : { border: `1px solid ${tokens.ink}` }),
        }}
      >
        {applied ? 'On the early-access list ✓' : 'Apply for early access'}
      </Button>
    </Card>
  );
}
