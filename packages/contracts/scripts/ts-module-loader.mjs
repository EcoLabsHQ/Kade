// Resolves ESM specifiers that end in ".js" to their TypeScript source when the
// ".js" file does not exist.
//
// @kade/shared is authored as TypeScript with NodeNext-style ".js" import
// specifiers (for example `./provenance.js`). Node can strip the types
// natively, but it does not rewrite those specifiers, so this hook bridges the
// gap. It lets the tooling in this package consume @kade/shared directly
// instead of re-declaring its contents.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      const candidate = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(candidate))) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
