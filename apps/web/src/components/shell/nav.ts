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
 * plain links. The Vote screen is a declared presentational mock per
 * `docs/week-3-frozen-delivery-contract.md` (VOTE-1): it renders reference copy
 * from local state and creates no capability, so its nav item is a plain link
 * too.
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
      { href: '/vote', label: 'Vote' },
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

/**
 * The resident nav for the current environment.
 *
 * The Colosseum residency surface is off by default (`KADE_COLOSSEUM=1`
 * enables it), so the nav must not link to a route that is a 404. When the gate
 * is on, the Residency group gains a Colosseum item; when it is off the item is
 * absent. `RESIDENT_NAV` stays the canonical gate-off list and is unchanged, so
 * a caller that wants the base nav can still read it directly.
 */
export function residentNav({
  colosseum,
}: {
  readonly colosseum: boolean;
}): readonly NavGroupConfig[] {
  if (!colosseum) return RESIDENT_NAV;
  return RESIDENT_NAV.map((group) =>
    group.label === 'Residency'
      ? {
          ...group,
          items: [
            ...group.items,
            { href: '/colosseum', label: 'Colosseum' },
          ],
        }
      : group,
  );
}
