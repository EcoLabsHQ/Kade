#!/usr/bin/env node
/**
 * Generates supabase/seed.sql from @kade/shared.
 *
 *   node scripts/db/generate-seed.mjs            # writes supabase/seed.sql
 *   node scripts/db/generate-seed.mjs --stdout   # prints instead of writing
 *
 * The seed is generated rather than hand-written so it cannot drift from the
 * chain registry or the fee formula (ADR 0005, contract EXE-002).
 *
 * The shared package is TypeScript whose internal imports use `.js` specifiers
 * (the standard TS-ESM convention). Node strips types natively, but it does not
 * remap `.js` to `.ts`, so this script registers a small synchronous resolver
 * hook before importing the builder. No build step or bundler is needed.
 *
 * Requires Node with type stripping and module.registerHooks (the repo's .nvmrc
 * is 22; the current environment is Node 26).
 */

import { registerHooks } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (typeof registerHooks !== 'function') {
  console.error(
    'generate-seed: this script needs Node with module.registerHooks and TypeScript ' +
      'type stripping (Node >= 22.15). The repository .nvmrc pins a newer Node.',
  );
  process.exit(1);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier.slice(0, -3) + '.ts', context);
      } catch {
        // Not a TypeScript source (for example a real .js dependency); fall back.
      }
    }
    return nextResolve(specifier, context);
  },
});

const here = dirname(fileURLToPath(import.meta.url));
const builderUrl = pathToFileURL(resolve(here, 'seed-sql.ts')).href;
const { buildSeedSql } = await import(builderUrl);

const sql = buildSeedSql();

if (process.argv.includes('--stdout')) {
  process.stdout.write(sql);
} else {
  const outPath = resolve(here, '..', '..', 'supabase', 'seed.sql');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, sql, 'utf8');
  process.stdout.write(`wrote ${outPath} (${Buffer.byteLength(sql, 'utf8')} bytes)\n`);
}
