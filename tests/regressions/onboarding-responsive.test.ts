/**
 * Regression: the onboarding steps stayed multi-column on a phone.
 *
 * The flow recreated from the design handoff styled its multi-column steps with
 * inline `gridTemplateColumns`. An inline style cannot carry a media query, so
 * while the shell collapsed at 768px, the profile/household split, the
 * proof-of-wealth split, the fee split, the tier cards and the fee rows did not:
 * two or three columns were squeezed into a viewport that fits one.
 *
 * jsdom does not evaluate media queries, so this test does not pretend to
 * simulate a narrow viewport. It asserts the two things that can be asserted
 * honestly: the stylesheet collapses each flow grid at the one breakpoint, and
 * each component hands the grid to that class instead of pinning it inline at
 * the call site.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const css = readFileSync(`${ROOT}apps/web/src/app/globals.css`, 'utf8');

/** The body of the first block opened by `query`, by brace matching. */
function blockAfter(source: string, query: string): string {
  const start = source.indexOf(query);
  expect(start, `expected to find ${query}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${query}`);
}

/** Every grid the onboarding flow renders that must collapse on a phone. */
const FLOW_GRIDS: ReadonlyArray<{ file: string; className: string }> = [
  {
    file: 'apps/web/src/components/onboarding/OnboardingWizard.tsx',
    className: 'kade-grid-profile',
  },
  {
    file: 'apps/web/src/components/onboarding/WealthStep.tsx',
    className: 'kade-grid-wealth',
  },
  {
    file: 'apps/web/src/components/onboarding/FeeStep.tsx',
    className: 'kade-grid-fee',
  },
  {
    file: 'apps/web/src/components/onboarding/TierSelector.tsx',
    className: 'kade-grid-tiers',
  },
  {
    file: 'apps/web/src/components/onboarding/FeeStep.tsx',
    className: 'kade-grid-file-row',
  },
];

describe('onboarding flow collapses below the shell breakpoint', () => {
  it('declares every flow grid in the stylesheet', () => {
    for (const { className } of FLOW_GRIDS) {
      expect(css).toMatch(new RegExp(`\\.${className}\\s*\\{`));
    }
  });

  it('collapses every flow grid to one column at the narrow breakpoint', () => {
    const narrow = blockAfter(css, '@media (max-width: 768px)');
    for (const { className } of FLOW_GRIDS) {
      const rule = blockAfter(narrow, `.${className}`);
      expect(rule, `${className} must become one column`).toMatch(
        /grid-template-columns:\s*1fr/,
      );
    }
  });

  it('hands each flow grid to its class instead of an inline column list', () => {
    for (const { file, className } of FLOW_GRIDS) {
      const source = readFileSync(`${ROOT}${file}`, 'utf8');
      expect(source, `${file} must use .${className}`).toContain(className);

      // Presence of the class is not enough: an inline `gridTemplateColumns`
      // on the same element would outrank the media query and the grid would
      // stop collapsing while this test still passed. Assert the inline style
      // that accompanies the class does not carry a column list.
      const element = new RegExp(
        `className="${className}"[\\s\\S]{0,200}?style=\\{\\{([\\s\\S]*?)\\}\\}`,
      );
      const match = source.match(element);
      expect(
        match,
        `${file} must render ${className} with an inline style block`,
      ).not.toBeNull();
      expect(
        match?.[1] ?? '',
        `${className} must not pin gridTemplateColumns inline`,
      ).not.toMatch(/gridTemplateColumns/);
    }
  });
});
