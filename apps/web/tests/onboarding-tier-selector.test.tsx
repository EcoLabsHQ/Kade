import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TIERS } from '@kade/shared';
import { TierSelector } from '@/components/onboarding/TierSelector';

/**
 * The tier selector carries the three production tiers plus the Colosseum
 * Resident demo tier. These tests pin the fourth card and that selecting it
 * reports the Colosseum tier index, without touching the production cards.
 */

afterEach(() => {
  cleanup();
});

describe('TierSelector — the Colosseum Resident tier', () => {
  it('renders a fourth card for the 10 USDC Colosseum tier', () => {
    render(<TierSelector value={null} onSelect={() => {}} />);

    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(
      screen.getByRole('radio', { name: /Colosseum Resident \$10/ }),
    ).toBeInTheDocument();
    // The three production cards are unchanged.
    expect(screen.getByRole('radio', { name: /3-year \$280,000/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /5-year \$425,000/ })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Indefinite \$850,000/ }),
    ).toBeInTheDocument();
  });

  it('selects the Colosseum tier index when its card is clicked', () => {
    const onSelect = vi.fn();
    render(<TierSelector value={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('radio', { name: /Colosseum Resident/ }));

    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('marks the Colosseum card selected when its index is the value', () => {
    render(<TierSelector value={3} onSelect={() => {}} />);

    expect(
      screen.getByRole('radio', { name: /Colosseum Resident/ }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('the Colosseum card reports the shared tier minimum, not a local constant', () => {
    const colosseum = TIERS.find((tier) => tier.name === 'Colosseum Resident');
    expect(colosseum?.minUsdc).toBe(10);
  });
});
