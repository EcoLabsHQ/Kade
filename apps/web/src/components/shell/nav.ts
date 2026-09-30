export interface NavItemConfig {
  readonly href: string;
  readonly label: string;
  readonly locked?: boolean;
  readonly lockReason?: string;
}

export interface NavGroupConfig {
  readonly label?: string;
  readonly items: readonly NavItemConfig[];
}

/**
 * Resident navigation.
 *
 * Week 2 unlocks the Residency step, Holdings and Invest — they are in scope per
 * `docs/week-2-frozen-delivery-contract.md` (D16–D18). The Finance rails
 * (Bank ↔ Crypto and Card & Banking) are a purely presentational mock, in scope
 * for the Week 3 increment per `docs/week-3-frozen-delivery-contract.md`
 * (FIN-1): they render demo data and create no capability, so their nav items are
 * plain links. Vote stays locked — the Week 2 contract defers it to the end of
 * the programme (§2.1).
 *
 * Residency setup (onboarding) and Account & passkey are deliberately **not**
 * nav items: the flow is reached from the Overview, and account settings from the
 * gear on the Safe card. Locked destinations still render (the shell matches the
 * baseline) rather than being removed.
 */
export const RESIDENT_NAV: readonly NavGroupConfig[] = [
  {
    items: [{ href: '/', label: 'Overview' }],
  },
  {
    label: 'Residency',
    items: [
      { href: '/residency', label: 'Residency' },
      {
        href: '/vote',
        label: 'Vote',
        locked: true,
        lockReason:
          'Vote is deferred to the end of the programme (week-2 contract §2.1)',
      },
    ],
  },
  {
    label: 'Assets',
    items: [
      { href: '/holdings', label: 'Holdings' },
      { href: '/invest', label: 'Invest' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/bank', label: 'Bank ↔ Crypto' },
      { href: '/card', label: 'Card & Banking' },
    ],
  },
];
