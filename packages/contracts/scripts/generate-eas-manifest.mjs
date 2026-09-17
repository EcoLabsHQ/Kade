// Emits the EAS registration manifest as a committed JSON artifact.
//
// The manifest is generated from @kade/shared so it cannot silently diverge
// from the shared schema definitions. It performs no network access and writes
// only the manifest file.
import { writeFileSync } from 'node:fs';
import { MANIFEST_PATH, buildManifest, serializeManifest } from './eas-manifest.mjs';

const manifest = buildManifest();
writeFileSync(MANIFEST_PATH, serializeManifest(manifest));

console.log(`Wrote ${MANIFEST_PATH.pathname}`);
console.log(`Schemas (${manifest.schemas.length}): ${manifest.schemas.map((s) => s.name).join(', ')}`);
