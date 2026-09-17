/**
 * Deterministic `supabase/seed.sql` builder.
 *
 * This module is the single implementation of the seed. It is imported by:
 *   - scripts/db/generate-seed.mjs, which writes supabase/seed.sql; and
 *   - tests/acceptance/seed-drift.test.ts, which regenerates the seed in memory
 *     and asserts it is byte-for-byte the committed file.
 *
 * Everything comes from @kade/shared so the seed cannot drift from the chain
 * registry or the frozen fee formula (ADR 0005). No timestamps and no randomness
 * are used, so the output is stable.
 *
 * @kade/shared is imported through the monorepo source path rather than the
 * package name so this file needs no bundler alias and works under both Node
 * (scripts/db/generate-seed.mjs) and Vitest (the drift guard).
 */

import {
  ALL_CHAINS,
  feeScheduleFor,
  preapprovalFeeUsdc,
  XCG_PER_USDC,
  type FeeMode,
} from '../../packages/shared/src/index.js';

/** Column order for the `chains` insert. Matches the DOCX section 9 order for
 *  the documented columns; env and schema_registry_address are appended because
 *  they are required by EXE-002 / D6 (see the migration comments). */
const CHAIN_COLUMNS = [
  'chain_id',
  'name',
  'env',
  'usdc_address',
  'eas_address',
  'schema_registry_address',
  'kadelock_address',
  'paymaster_policy_id',
  'explorer_url',
] as const;

const FEE_MODES = ['demo', 'production'] as const;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Pre-approval formula parameters as seeded into `fee_schedule`, in USDC.
 *
 * [documented] contract section 2.1 / DOCX section 7:
 *   demo:       1.00 USDC + 0.25 USDC per household member, exact to the cent
 *               (household of 3 -> 1.75).
 *   production: XCG 500 + XCG 100 per household member, settled in USDC at the
 *               CBCS peg and rounded to whole USDC (household of 3 -> 447).
 *
 * The production XCG parameters are divided by XCG_PER_USDC from @kade/shared,
 * so the peg is never re-typed here. Rounding the resulting USDC parameters to
 * the fee_schedule precision is checked by assertFormulaMatchesShared() below.
 */
const PREAPPROVAL_FORMULA: Record<
  FeeMode,
  { readonly base: number; readonly perMember: number; readonly roundingScale: number }
> = {
  demo: { base: 1, perMember: 0.25, roundingScale: 2 },
  production: {
    base: roundTo(500 / XCG_PER_USDC, 6),
    perMember: roundTo(100 / XCG_PER_USDC, 6),
    roundingScale: 0,
  },
};

/**
 * The seeded parameters are only correct if they reproduce the single shared
 * implementation for every household size. Running this at seed-build time
 * means a change in @kade/shared that the schedule no longer satisfies fails
 * generation (and therefore the drift guard) instead of silently diverging.
 */
function assertFormulaMatchesShared(): void {
  for (const mode of FEE_MODES) {
    const { base, perMember, roundingScale } = PREAPPROVAL_FORMULA[mode];
    for (let size = 1; size <= 1000; size++) {
      const fromSchedule = roundTo(base + perMember * size, roundingScale);
      const fromShared = preapprovalFeeUsdc(mode, size);
      if (fromSchedule !== fromShared) {
        throw new Error(
          `fee drift: ${mode} household of ${size} -> schedule ` +
            `${fromSchedule}, @kade/shared ${fromShared}`,
        );
      }
    }
  }
}

interface FeeRow {
  readonly mode: FeeMode;
  readonly key: string;
  /** Household-size-1 fee (pre-approval) or flat fee (service), USDC. */
  readonly amount: number;
  readonly baseAmount: number;
  readonly perMemberAmount: number;
  readonly roundingScale: number;
  readonly currency: string;
}

function feeRows(): FeeRow[] {
  assertFormulaMatchesShared();
  return FEE_MODES.flatMap((mode) => {
    const formula = PREAPPROVAL_FORMULA[mode];
    const service = feeScheduleFor(mode).find((fee) => fee.key === 'service');
    if (service === undefined) {
      throw new Error(`@kade/shared has no service fee for mode ${mode}`);
    }
    return [
      {
        mode,
        key: 'preapproval',
        amount: roundTo(formula.base + formula.perMember, formula.roundingScale),
        baseAmount: formula.base,
        perMemberAmount: formula.perMember,
        roundingScale: formula.roundingScale,
        currency: 'USDC',
      },
      {
        mode,
        key: service.key,
        amount: service.amount,
        baseAmount: service.amount,
        perMemberAmount: 0,
        roundingScale: 2,
        currency: service.currency,
      },
    ];
  });
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullable(value: string | null | undefined): string {
  return value === null || value === undefined ? 'null' : sqlLiteral(value);
}

function arbitraryNote(
  chainName: string,
  label: string,
  sourced: { provenance: string; note?: string },
): string | null {
  if (sourced.provenance !== 'arbitrary') {
    return null;
  }
  return `--   ${chainName}: ${label}${sourced.note ? ` (${sourced.note})` : ''}`;
}

function chainProvenanceNotes(): string[] {
  const notes: string[] = [];
  for (const chain of ALL_CHAINS) {
    const fields: [string, { provenance: string; note?: string }][] = [
      ['usdc_address', chain.usdcAddress],
      ['eas_address', chain.easAddress],
      ['schema_registry_address', chain.schemaRegistryAddress],
      ['kadelock_address', chain.kadeLockAddress],
      ['paymaster_policy_id', chain.paymasterPolicyId],
    ];
    for (const [label, sourced] of fields) {
      const note = arbitraryNote(chain.name, label, sourced);
      if (note !== null) {
        notes.push(note);
      }
    }
  }
  return notes;
}

function chainsInsert(): string[] {
  const rows = ALL_CHAINS.map((chain) => {
    const values = [
      String(chain.chainId),
      sqlLiteral(chain.name),
      sqlLiteral(chain.env),
      sqlNullable(chain.usdcAddress.value),
      sqlNullable(chain.easAddress.value),
      sqlNullable(chain.schemaRegistryAddress.value),
      sqlNullable(chain.kadeLockAddress.value),
      sqlNullable(chain.paymasterPolicyId.value),
      sqlLiteral(chain.explorerUrl),
    ];
    return `  (${values.join(', ')})`;
  });

  const body = [
    `insert into public.chains (${CHAIN_COLUMNS.join(', ')})`,
    'values',
    rows.join(',\n'),
    'on conflict (chain_id) do update set',
    '  name = excluded.name,',
    '  env = excluded.env,',
    '  usdc_address = excluded.usdc_address,',
    '  eas_address = excluded.eas_address,',
    '  schema_registry_address = excluded.schema_registry_address,',
    '  kadelock_address = excluded.kadelock_address,',
    '  paymaster_policy_id = excluded.paymaster_policy_id,',
    '  explorer_url = excluded.explorer_url;',
  ];
  return body;
}

function feeScheduleInsert(): string[] {
  const rows = feeRows().map(
    (fee) =>
      `  (${sqlLiteral(fee.mode)}, ${sqlLiteral(fee.key)}, ${String(fee.amount)}, ` +
      `${String(fee.baseAmount)}, ${String(fee.perMemberAmount)}, ` +
      `${String(fee.roundingScale)}, ${sqlLiteral(fee.currency)})`,
  );

  return [
    '-- fee_schedule: both keys in both modes (contract section 2.1).',
    '-- amount is the household-size-1 fee (pre-approval) or flat fee (service).',
    '-- The pre-approval formula parameters are data, in USDC:',
    '--   fee = round(base_amount + per_member_amount x household_size, rounding_scale)',
    '-- Production folds the documented XCG 500 / XCG 100 table into USDC through',
    '-- XCG_PER_USDC from @kade/shared. feeRows() asserts these parameters',
    '-- reproduce preapprovalFeeUsdc() before this seed is written (ADR 0005).',
    'insert into public.fee_schedule (mode, key, amount, base_amount, per_member_amount, rounding_scale, currency)',
    'values',
    rows.join(',\n'),
    'on conflict (mode, key) do update set',
    '  amount = excluded.amount,',
    '  base_amount = excluded.base_amount,',
    '  per_member_amount = excluded.per_member_amount,',
    '  rounding_scale = excluded.rounding_scale,',
    '  currency = excluded.currency;',
  ];
}

export function buildSeedSql(): string {
  const lines: string[] = [
    '-- -----------------------------------------------------------------------------',
    '-- supabase/seed.sql - GENERATED FILE, DO NOT EDIT BY HAND.',
    '-- Regenerate with: node scripts/db/generate-seed.mjs',
    '--',
    '-- Source of truth: @kade/shared (packages/shared/src/chains.ts, fees.ts).',
    '-- Decision: docs/architecture/adr/0005-config-over-code.md.',
    '-- Contract: week-1 section 3 (EXE-002) and section 2.1 (frozen fee model).',
    '--',
    '-- Provenance markers: [documented] contract/DOCX; [external] issuer docs;',
    '-- [arbitrary] not stated in the governing documents (human gate required).',
    '-- -----------------------------------------------------------------------------',
    'begin;',
    '',
    '-- chains: three testnets and three mainnets (contract EXE-002).',
    '-- [arbitrary] values in these rows:',
    ...chainProvenanceNotes(),
    ...chainsInsert(),
    '',
    ...feeScheduleInsert(),
    '',
    'commit;',
    '',
  ];
  return lines.join('\n');
}
