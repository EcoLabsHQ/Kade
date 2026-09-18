import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preapprovalFeeUsdc } from '@kade/shared';

const hoisted = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.push, refresh: hoisted.refresh }),
}));
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import type {
  OnboardingSnapshot,
  OnboardingStore,
} from '@/lib/onboarding/persistence';

afterEach(() => {
  cleanup();
  hoisted.push.mockReset();
  hoisted.refresh.mockReset();
});

function makeStore() {
  const save = vi.fn(
    async (userId: string, snapshot: OnboardingSnapshot) => ({
      applicationId: `app-${userId}`,
      preapprovalUsdc: preapprovalFeeUsdc('demo', 1 + snapshot.members.length),
    }),
  );
  const store: OnboardingStore = { mode: 'supabase', load: async () => null, save };
  return { store, save };
}

function renderWizard(
  store: OnboardingStore,
  persistence: 'supabase' | 'not-configured' = 'supabase',
) {
  return render(
    <OnboardingWizard
      mode="demo"
      userId="user-1"
      persistence={persistence}
      currentYear={2026}
      store={store}
    />,
  );
}

describe('Step 2 wizard', () => {
  it('starts populated with demo defaults, so the demo can be clicked through', () => {
    const { store } = makeStore();
    renderWizard(store);

    expect(screen.getByLabelText('First name')).toHaveValue('Marcus');
    expect(screen.getByLabelText('Last name')).toHaveValue('Feldt');
    // Household of three, the contract's worked example.
    expect(screen.getByRole('radio', { name: /3-year/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('enables Continue with the populated draft', () => {
    const { store } = makeStore();
    renderWizard(store);

    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('does not mention the pre-approval fee: it belongs to step 4', () => {
    const { store } = makeStore();
    renderWizard(store);

    expect(screen.queryByText(/pre-approval fee/i)).toBeNull();
    expect(screen.queryByText(/USDC/)).toBeNull();
  });

  it('does not list validation blockers above the form', () => {
    const { store } = makeStore();
    renderWizard(store);

    // The blocker list was developer-facing copy at the top of the screen; the
    // fields themselves say what is missing.
    expect(screen.queryByText(/before you can continue/i)).toBeNull();
  });

  it('saves the populated draft through the seam', async () => {
    const { store, save } = makeStore();
    renderWizard(store);

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [userId, snapshot] = save.mock.calls[0] ?? [];
    expect(userId).toBe('user-1');
    expect(snapshot).not.toHaveProperty('amount');
    expect(snapshot?.profile).toEqual({
      firstName: 'Marcus',
      lastName: 'Feldt',
      dob: '1982-03-14',
    });
    expect(snapshot?.members).toHaveLength(2);

    // Saving moves the resident on: the button does something visible.
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/'));
  });

  it('renders a not-configured state and never fakes a save', () => {
    const save = vi.fn();
    const store: OnboardingStore = {
      mode: 'not-configured',
      load: async () => null,
      save,
    };
    renderWizard(store, 'not-configured');

    expect(screen.getByText('Saving not configured')).toBeInTheDocument();
    const continueButton = screen.getByRole('button', { name: /continue/i });
    expect(continueButton).toBeDisabled();
    expect(continueButton.getAttribute('title')).toMatch(/not configured/i);

    fireEvent.click(continueButton);
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Saved$/)).not.toBeInTheDocument();
  });
});
