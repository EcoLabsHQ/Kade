import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingSnapshot } from '@/lib/onboarding/persistence';

/**
 * The one "onboarding complete" rule, shared by the post-login callback
 * (`postLoginPath`) and the Overview gate (`hasCompletedOnboarding`).
 *
 * Regression: the shared write schemas gained a required gender and a strict
 * relation *after* residents had already finished onboarding, and a stored NULL
 * is never back-filled. Evaluating completeness with the write schema unchanged
 * sent a finished resident back through the flow. These tests pin that a legacy
 * row is complete, that a genuinely incomplete one is not, and that a *present
 * but invalid* value still blocks.
 */

const hoisted = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock('@/lib/onboarding/server', () => ({
  loadOnboardingSnapshot: hoisted.load,
}));

import { hasCompletedOnboarding, postLoginPath } from '@/lib/onboarding/state';

const YEAR = new Date().getFullYear();

function currentSnapshot(
  overrides: Partial<OnboardingSnapshot> = {},
): OnboardingSnapshot {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  hoisted.load.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('onboarding completeness — one rule for the callback and the gate', () => {
  it('reports a current, fully valid resident as complete and lands on the overview', async () => {
    hoisted.load.mockResolvedValue(currentSnapshot());

    await expect(hasCompletedOnboarding('user')).resolves.toBe(true);
    await expect(postLoginPath('user')).resolves.toBe('/');
  });

  it('reports a legacy resident (NULL gender, legacy relation) as complete', async () => {
    // The exact shape of the pre-gender rows read from the live project: the
    // read seam maps a stored NULL to '' for both the applicant and a member,
    // and a relation outside the new enum is preserved as free text.
    hoisted.load.mockResolvedValue(
      currentSnapshot({
        profile: {
          firstName: 'Luuk',
          lastName: 'Weber',
          dob: '1995-10-10',
          gender: '',
        },
        members: [
          {
            name: 'My Wife',
            relation: 'Wife',
            dob: '1990-10-01',
            citizenship: 'NL',
            gender: '',
          },
        ],
      }),
    );

    await expect(hasCompletedOnboarding('user')).resolves.toBe(true);
    await expect(postLoginPath('user')).resolves.toBe('/');
  });

  it('still reports a genuinely incomplete resident as incomplete', async () => {
    hoisted.load.mockResolvedValue(
      currentSnapshot({ citizenships: [], members: [] }),
    );

    await expect(hasCompletedOnboarding('user')).resolves.toBe(false);
    await expect(postLoginPath('user')).resolves.toBe('/onboarding');
  });

  it('still blocks a present but invalid gender (only an absent one is legacy)', async () => {
    hoisted.load.mockResolvedValue(
      currentSnapshot({
        profile: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          dob: '1990-01-01',
          gender: 'Non-binary',
        },
      }),
    );

    await expect(hasCompletedOnboarding('user')).resolves.toBe(false);
    await expect(postLoginPath('user')).resolves.toBe('/onboarding');
  });

  it('still blocks a household member with an empty relation', async () => {
    hoisted.load.mockResolvedValue(
      currentSnapshot({
        members: [
          {
            name: 'Ada',
            relation: '',
            dob: '1990-01-01',
            citizenship: 'NL',
            gender: 'Female',
          },
        ],
      }),
    );

    await expect(hasCompletedOnboarding('user')).resolves.toBe(false);
    await expect(postLoginPath('user')).resolves.toBe('/onboarding');
  });

  it('treats an absent snapshot as incomplete', async () => {
    hoisted.load.mockResolvedValue(null);

    await expect(hasCompletedOnboarding('user')).resolves.toBe(false);
    await expect(postLoginPath('user')).resolves.toBe('/onboarding');
  });

  it('treats a read failure as incomplete rather than as an empty draft', async () => {
    hoisted.load.mockRejectedValue(new Error('read failed'));

    await expect(hasCompletedOnboarding('user')).resolves.toBe(false);
    await expect(postLoginPath('user')).resolves.toBe('/onboarding');
  });
});
