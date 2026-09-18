import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * React Testing Library's automatic cleanup relies on a *global* `afterEach`,
 * which this workspace does not enable (`globals: false` in vitest.config.ts).
 * Without it, each `render` accumulates in the same jsdom document, so a later
 * test can match elements left behind by an earlier one — a passing test that
 * really asserted against the wrong render, or a spurious "found multiple
 * elements" failure.
 *
 * Registering it explicitly here fixes that for every test file at once.
 */
afterEach(() => {
  cleanup();
});
