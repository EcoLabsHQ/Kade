/**
 * Seed drift guard.
 *
 * supabase/seed.sql is generated from @kade/shared (ADR 0005, contract EXE-002).
 * If the committed file and the generator disagree, the seed has been hand-edited
 * or the shared registry changed without regenerating, either of which lets the
 * database and the application disagree about fees or chain addresses.
 *
 * This test is dependency-light and needs no database. It imports the builder
 * through the monorepo source path, so it works without the @kade/shared alias.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSeedSql } from '../../scripts/db/seed-sql.js';

const committedSeedPath = fileURLToPath(new URL('../../supabase/seed.sql', import.meta.url));

describe('EXE-002 seed drift guard', () => {
  it('regenerates supabase/seed.sql byte-for-byte', () => {
    const committed = readFileSync(committedSeedPath, 'utf8');
    expect(buildSeedSql()).toBe(committed);
  });

  it('seeds both fee keys in both modes', () => {
    const sql = buildSeedSql();
    for (const mode of ['demo', 'production']) {
      for (const key of ['preapproval', 'service']) {
        expect(sql).toContain(`'${mode}', '${key}'`);
      }
    }
  });

  it('seeds all three testnets and all three mainnets', () => {
    const sql = buildSeedSql();
    for (const chainId of [11155111, 421614, 84532, 1, 42161, 8453]) {
      expect(sql).toContain(`(${chainId}, `);
    }
  });
});
