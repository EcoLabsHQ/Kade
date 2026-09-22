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
 * `docs/week-2-frozen-delivery-contract.md` (D16–D18). Vote and the Finance
 * rails stay locked: the Week 2 contract defers them to the end of the
 * programme (§2.1). Locked destinations still render (the shell matches the
 * baseline) rather than being removed.
 */
export const RESIDENT_NAV: readonly NavGroupConfig[] = [
  {
    items: [{ href: '/', label: 'Overview' }],
  },
  {
    label: 'Residency',
    items: [
      { href: '/onboarding', label: 'Residency setup' },
      { href: '/residency', label: 'Residency' },
      { href: '/account', label: 'Account & passkey' },
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
      {
        href: '/bank',
        label: 'Bank ↔ Crypto',
        locked: true,
        lockReason:
          'Bank ↔ Crypto is deferred to the end of the programme (week-2 contract §2.1)',
      },
      {
        href: '/card',
        label: 'Card & Banking',
        locked: true,
        lockReason:
          'Card & Banking is deferred to the end of the programme (week-2 contract §2.1)',
      },
    ],
  },
];
