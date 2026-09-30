/**
 * The Onchain Island card face (kade-mvp.dc.html 569–572 and 618–621).
 *
 * Purely presentational: the masked PAN and the holder name are seed demo
 * values, and nothing here reads or writes a chain.
 */
export interface CardVisualProps {
  /** The masked PAN line, e.g. `•••• •••• •••• 4821`. */
  readonly number: string;
  /** The bottom-right label: `VISA` before issue, `VISA · 09/30` after. */
  readonly expiry: string;
  /** The reference dims the pre-order card to `.9`; the active one is full. */
  readonly opacity?: number;
}

export function CardVisual({ number, expiry, opacity = 1 }: CardVisualProps) {
  return (
    <div
      style={{
        aspectRatio: '1.586',
        borderRadius: '14px',
        background: 'linear-gradient(135deg,#0063B5 0%,#101828 100%)',
        color: '#fff',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        opacity,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the reference
            draws the brand mark as a plain <img> carrying a brightness/invert
            filter, which next/image cannot express inline. The asset lives in
            this app's public/ (not reference/), so it is loaded at runtime. */}
        <img
          src="/onchain-island-logo.png"
          alt=""
          style={{ height: '18px', filter: 'brightness(0) invert(1)' }}
        />
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '.1em',
            opacity: 0.8,
          }}
        >
          GOS
        </span>
      </div>
      <div>
        <div
          style={{
            fontSize: '15px',
            letterSpacing: '.14em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {number}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '8px',
            fontSize: '11px',
            opacity: 0.85,
          }}
        >
          <span>MARCUS FELDT</span>
          <span>{expiry}</span>
        </div>
      </div>
    </div>
  );
}
