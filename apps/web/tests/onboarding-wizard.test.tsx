import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { preapprovalFeeUsdc } from '@kade/shared';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import type {
  OnboardingSnapshot,
  OnboardingStore,
} from '@/lib/onboarding/persistence';

afterEach(cleanup);

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

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('First name'), {
    target: { value: 'Ada' },
  });
  fireEvent.change(screen.getByLabelText('Last name'), {
    target: { value: 'Lovelace' },
  });
  fireEvent.change(screen.getByLabelText('Date of birth'), {
    target: { value: '1990-01-01' },
  });
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Add citizenship' }),
    { target: { value: 'NL' } },
  );
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Add residence country' }),
    { target: { value: 'DE' } },
  );
  fireEvent.click(screen.getByRole('radio', { name: /3-year/ }));
}

describe('Step 2 wizard', () => {
  it('starts empty, shows the shared live fee, and gates Continue', () => {
    const { store } = makeStore();
    renderWizard(store);

    expect(screen.getByText('1.25 USDC')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /continue/i }),
    ).toBeDisabled();
    expect(screen.getByText('First name is required.')).toBeInTheDocument();
    expect(screen.getByText('At least one citizenship is required.')).toBeInTheDocument();
  });

  it('recalculates the fee when a household member is added and removed', () => {
    const { store } = makeStore();
    renderWizard(store);

    fireEvent.click(screen.getByRole('button', { name: '+ Add member' }));
    expect(
      screen.getByText(`${preapprovalFeeUsdc('demo', 2).toFixed(2)} USDC`),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove household member 1' }),
    );
    expect(
      screen.getByText(`${preapprovalFeeUsdc('demo', 1).toFixed(2)} USDC`),
    ).toBeInTheDocument();
  });

  it('cannot advance while validation fails, then enables when valid', () => {
    const { store } = makeStore();
    renderWizard(store);

    const continueButton = screen.getByRole('button', { name: /continue/i });
    expect(continueButton).toBeDisabled();

    fillValidForm();
    expect(
      screen.getByRole('button', { name: /continue/i }),
    ).toBeEnabled();
  });

  it('saves through the seam and reports the server-confirmed fee', async () => {
    const { store, save } = makeStore();
    renderWizard(store);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [userId, snapshot] = save.mock.calls[0] ?? [];
    expect(userId).toBe('user-1');
    expect(snapshot).not.toHaveProperty('amount');
    expect(snapshot?.profile).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      dob: '1990-01-01',
    });

    await waitFor(() =>
      expect(screen.getByText(/Server-confirmed pre-approval fee/i)).toBeInTheDocument(),
    );
  });

  it('renders a not-configured state and never fakes a save', () => {
    const save = vi.fn();
    const store: OnboardingStore = {
      mode: 'not-configured',
      load: async () => null,
      save,
    };
    renderWizard(store, 'not-configured');
    fillValidForm();

    expect(screen.getByText('Saving not configured')).toBeInTheDocument();
    const continueButton = screen.getByRole('button', { name: /continue/i });
    expect(continueButton).toBeDisabled();
    expect(continueButton.getAttribute('title')).toMatch(/not configured/i);

    fireEvent.click(continueButton);
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Saved$/)).not.toBeInTheDocument();
  });
});
