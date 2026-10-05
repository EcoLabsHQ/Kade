import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preapprovalFeeUsdc } from '@kade/shared';

const hoisted = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.push, refresh: hoisted.refresh }),
}));
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { tokens } from '@/components/ui/tokens';
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

const YEAR = new Date().getFullYear();

/** A restored, fully valid snapshot; the applicant alone is a household of one. */
const validSnapshot: OnboardingSnapshot = {
  profile: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dob: '1990-01-01',
    gender: 'Female',
  },
  citizenships: ['NL'],
  residences: [{ countryCode: 'NL', fromYear: YEAR - 5, toYear: 'present' }],
  tier: 1,
  members: [],
};

function renderWizard(
  store: OnboardingStore,
  persistence: 'supabase' | 'not-configured' = 'supabase',
  initial: OnboardingSnapshot | null = null,
) {
  return render(
    <OnboardingWizard
      mode="demo"
      userId="user-1"
      persistence={persistence}
      currentYear={2026}
      initial={initial}
      store={store}
    />,
  );
}

describe('Step 2 wizard', () => {
  it('starts empty: no names, no citizenship, no tier, no household', () => {
    renderWizard(makeStore().store);

    expect(screen.getByLabelText('First name')).toHaveValue('');
    expect(screen.getByLabelText('Last name')).toHaveValue('');
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByText(/no household members yet/i)).toBeInTheDocument();
    // The empty citizenship editor still offers the "+ Add country" select.
    expect(screen.getByLabelText('Add citizenship')).toBeInTheDocument();
  });

  it('keeps Continue clickable but grey while the form is empty', () => {
    renderWizard(makeStore().store);

    const continueButton = screen.getByRole('button', { name: /^continue$/i });
    expect(continueButton).toBeEnabled();
    expect(continueButton).toHaveStyle({ backgroundColor: tokens.locked });
  });

  it('paints Continue blue once the form is complete', () => {
    renderWizard(makeStore().store, 'supabase', validSnapshot);

    const continueButton = screen.getByRole('button', { name: /^continue$/i });
    expect(continueButton).toBeEnabled();
    expect(continueButton).toHaveStyle({ backgroundColor: tokens.action });
  });

  it('does not pre-fill example values', () => {
    renderWizard(makeStore().store);

    expect(screen.getByLabelText('First name')).toHaveValue('');
    expect(screen.queryByDisplayValue('Marcus')).toBeNull();
    expect(screen.queryByDisplayValue('Feldt')).toBeNull();
    expect(screen.queryByText('Example details')).toBeNull();
  });

  it('marks the form and does not save when Continue is clicked on an empty form', () => {
    const { store, save } = makeStore();
    renderWizard(store);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getByText('Please complete all required fields to continue.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Last name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Date of birth')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Gender')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      screen.getByRole('radiogroup', {
        name: 'Permit tier you are aiming for',
      }),
    ).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders the date of birth as a dd/mm/yyyy trigger, not a native date input', () => {
    renderWizard(makeStore().store);

    const dob = screen.getByLabelText('Date of birth');
    // The field is a typeable text input now, so the empty state lives in the
    // placeholder rather than in the element's text. It is still not a native
    // date input.
    expect(dob).toHaveAttribute('type', 'text');
    expect(dob).toHaveAttribute('placeholder', 'dd/mm/yyyy');
    expect(dob).toHaveValue('');
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('renders a household date of birth as the styled calendar, not a native input', () => {
    const withMember: OnboardingSnapshot = {
      ...validSnapshot,
      members: [
        { name: 'Grace', relation: 'Child', dob: '1992-05-05', citizenship: 'DE', gender: 'Female' },
      ],
    };
    renderWizard(makeStore().store, 'supabase', withMember);

    const dob = screen.getByLabelText('Household member 1 date of birth');
    expect(dob).toHaveAttribute('aria-haspopup', 'dialog');
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('accepts a minor household member: the 18+ floor was removed', async () => {
    const withChild: OnboardingSnapshot = {
      ...validSnapshot,
      members: [
        { name: 'Grace', relation: 'Child', dob: '2015-05-05', citizenship: 'DE', gender: 'Female' },
      ],
    };
    const { store, save } = makeStore();
    renderWizard(store, 'supabase', withChild);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it('still blocks a future household date of birth', () => {
    const nextYear = new Date().getFullYear() + 1;
    const withFuture: OnboardingSnapshot = {
      ...validSnapshot,
      members: [
        { name: 'Grace', relation: 'Child', dob: `${nextYear}-05-05`, citizenship: 'DE', gender: 'Female' },
      ],
    };
    const { store, save } = makeStore();
    renderWizard(store, 'supabase', withFuture);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getByText('Date of birth cannot be in the future.'),
    ).toBeInTheDocument();
  });

  it('keeps the draft ISO while the chosen date shows dd/mm/yyyy', () => {
    renderWizard(makeStore().store);

    fireEvent.click(screen.getByLabelText('Date of birth'));
    expect(
      screen.getByRole('dialog', { name: 'Date of birth' }),
    ).toBeInTheDocument();

    // The empty applicant calendar opens 40 years ago; pick a day in that view.
    const year = new Date().getFullYear() - 40;
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    fireEvent.click(screen.getByRole('button', { name: `${year}-${month}-15` }));

    expect(screen.queryByRole('dialog')).toBeNull();
    // The field is a text input, so the chosen date is its value.
    expect(screen.getByLabelText('Date of birth')).toHaveValue(
      `15/${month}/${year}`,
    );
  });

  it('opens the empty applicant calendar at 40 years ago without committing a value', () => {
    renderWizard(makeStore().store);

    fireEvent.click(screen.getByLabelText('Date of birth'));

    const year = new Date().getFullYear() - 40;
    expect(screen.getByLabelText('Year')).toHaveValue(String(year));
    expect(screen.getByRole('textbox', { name: 'Date of birth' })).toHaveValue('');
  });

  it('opens a Child household calendar at 16 years ago and others at 40', () => {
    const withMembers: OnboardingSnapshot = {
      ...validSnapshot,
      members: [
        { name: 'Grace', relation: 'Child', dob: '', citizenship: 'DE', gender: 'Female' },
        { name: 'Lena', relation: 'Spouse', dob: '', citizenship: 'NL', gender: 'Female' },
      ],
    };
    renderWizard(makeStore().store, 'supabase', withMembers);

    fireEvent.click(screen.getByLabelText('Household member 1 date of birth'));
    expect(screen.getByLabelText('Year')).toHaveValue(
      String(new Date().getFullYear() - 16),
    );
    fireEvent.keyDown(
      screen.getByLabelText('Household member 1 date of birth'),
      { key: 'Escape' },
    );

    fireEvent.click(screen.getByLabelText('Household member 2 date of birth'));
    expect(screen.getByLabelText('Year')).toHaveValue(
      String(new Date().getFullYear() - 40),
    );
    expect(screen.getByLabelText('Household member 2 date of birth')).toHaveValue(
      '',
    );
  });

  it('shows the gender dropdown and restores the stored gender', () => {
    renderWizard(makeStore().store, 'supabase', validSnapshot);
    expect(screen.getByLabelText('Gender')).toHaveValue('Female');
  });

  it('offers exactly Spouse, Partner and Child for a household relation', () => {
    const withMember: OnboardingSnapshot = {
      ...validSnapshot,
      members: [
        { name: 'Grace', relation: 'Child', dob: '2015-05-05', citizenship: 'DE', gender: 'Female' },
      ],
    };
    renderWizard(makeStore().store, 'supabase', withMember);

    const relation = screen.getByLabelText('Household member 1 relation');
    const options = Array.from(
      relation.querySelectorAll('option'),
    ).map((option) => (option as HTMLOptionElement).value);
    expect(options).toContain('Spouse');
    expect(options).toContain('Partner');
    expect(options).toContain('Child');
    // The three values plus the empty placeholder; no free-text relations.
    expect(options.filter((value) => value !== '')).toEqual([
      'Spouse',
      'Partner',
      'Child',
    ]);
  });

  it('shows a legacy relation as needing re-selection and blocks saving', () => {
    const withLegacy: OnboardingSnapshot = {
      ...validSnapshot,
      members: [
        { name: 'Pat', relation: 'Dependent parent', dob: '1950-01-01', citizenship: 'NL', gender: 'Other' },
      ],
    };
    const { store, save } = makeStore();
    renderWizard(store, 'supabase', withLegacy);

    // It loads without crashing and is visible in the dropdown.
    expect(screen.getByLabelText('Household member 1 relation')).toHaveValue(
      'Dependent parent',
    );
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getByText('Choose Spouse, Partner or Child to continue.'),
    ).toBeInTheDocument();
  });

  it('does not mention the pre-approval fee: it belongs to step 4', () => {
    renderWizard(makeStore().store);

    expect(screen.queryByText(/pre-approval fee/i)).toBeNull();
    expect(screen.queryByText(/USDC/)).toBeNull();
  });

  it('saves a restored, valid draft through the seam', async () => {
    const { store, save } = makeStore();
    renderWizard(store, 'supabase', validSnapshot);

    expect(screen.getByLabelText('First name')).toHaveValue('Ada');

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [userId, snapshot] = save.mock.calls[0] ?? [];
    expect(userId).toBe('user-1');
    expect(snapshot).not.toHaveProperty('amount');
    expect(snapshot?.profile).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      dob: '1990-01-01',
      gender: 'Female',
    });
    expect(snapshot?.members).toHaveLength(0);

    // Saving moves the resident on: the button does something visible.
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/'));
  });

  it('restores the resident\u2019s saved details instead of starting empty', () => {
    renderWizard(makeStore().store, 'supabase', validSnapshot);

    expect(screen.getByLabelText('First name')).toHaveValue('Ada');
    expect(screen.queryByText('Example details')).toBeNull();
  });

  it('validates before it ever fakes a save when persistence is not configured', () => {
    const save = vi.fn();
    const store: OnboardingStore = {
      mode: 'not-configured',
      load: async () => null,
      save,
    };
    renderWizard(store, 'not-configured');

    expect(screen.getByText('Saving not configured')).toBeInTheDocument();
    const continueButton = screen.getByRole('button', { name: /^continue$/i });
    expect(continueButton).toBeEnabled();

    fireEvent.click(continueButton);
    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getByText('Please complete all required fields to continue.'),
    ).toBeInTheDocument();
  });

  it('surfaces the not-configured reason instead of saving a valid draft', async () => {
    const save = vi.fn();
    const store: OnboardingStore = {
      mode: 'not-configured',
      load: async () => null,
      save,
    };
    renderWizard(store, 'not-configured', validSnapshot);

    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText('Save failed')).toBeInTheDocument();
  });

  it('keeps build vocabulary out of the rendered text', () => {
    renderWizard(makeStore().store);

    const text = document.body.textContent ?? '';
    for (const pattern of [/SUPABASE/i, /SERVICE_ROLE/i, /environment/i]) {
      expect(text).not.toMatch(pattern);
    }
  });
});
