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
 * Only Overview, Residency setup and Account are in Week 1 scope. The asset
 * and finance destinations are contract section 9 exclusions, so they render
 * locked rather than being removed (the shell must still match the baseline).
 */
export const RESIDENT_NAV: readonly NavGroupConfig[] = [
  {
    items: [{ href: '/', label: 'Overview' }],
  },
  {
    label: 'Residency',
    items: [
      { href: '/onboarding', label: 'Residency setup' },
      { href: '/account', label: 'Account & passkey' },
      {
        href: '/vote',
        label: 'Vote',
        locked: true,
        lockReason: 'Vote (Snapshot) is out of Week 1 scope (contract section 9)',
      },
    ],
  },
  {
    label: 'Assets',
    items: [
      {
        href: '/holdings',
        label: 'Holdings',
        locked: true,
        lockReason: 'Holdings are Week 2+ scope (contract section 9)',
      },
      {
        href: '/invest',
        label: 'Invest',
        locked: true,
        lockReason: 'Invest is out of Week 1 scope (contract section 9)',
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        href: '/bank',
        label: 'Bank ↔ Crypto',
        locked: true,
        lockReason: 'Bank ↔ Crypto is out of Week 1 scope (contract section 9)',
      },
      {
        href: '/card',
        label: 'Card & Banking',
        locked: true,
        lockReason: 'Card & Banking is out of Week 1 scope (contract section 9)',
      },
    ],
  },
];
