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

import { ALL_CHAINS, feeScheduleFor } from '../../packages/shared/src/index.js';

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
  const rows = FEE_MODES.flatMap((mode) =>
    feeScheduleFor(mode).map(
      (fee) => `  (${sqlLiteral(fee.mode)}, ${sqlLiteral(fee.key)}, ${String(fee.amount)}, ${sqlLiteral(fee.currency)})`,
    ),
  );

  return [
    '-- fee_schedule: both keys in both modes (contract section 2.1).',
    '-- amount is the base fee for the key; the pre-approval per-member increment',
    '-- is applied by preapprovalFeeUsdc() in @kade/shared (ADR 0005).',
    'insert into public.fee_schedule (mode, key, amount, currency)',
    'values',
    rows.join(',\n'),
    'on conflict (mode, key) do update set',
    '  amount = excluded.amount,',
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
