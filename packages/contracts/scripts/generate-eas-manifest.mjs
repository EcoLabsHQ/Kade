// Emits the EAS registration manifest and the Onchain gate review pack as
// committed artifacts.
//
// Both are generated from @kade/shared so they cannot silently diverge from the
// shared schema definitions. This performs no network access and writes only
// the two files.
import { writeFileSync } from 'node:fs';
import { MANIFEST_PATH, REVIEW_PATH, buildManifest, serializeManifest } from './eas-manifest.mjs';
import { buildReviewMarkdown, serializeReview } from './eas-review.mjs';

const manifest = buildManifest();
writeFileSync(MANIFEST_PATH, serializeManifest(manifest));

const review = serializeReview(buildReviewMarkdown(manifest));
writeFileSync(REVIEW_PATH, review);

console.log(`Wrote ${MANIFEST_PATH.pathname}`);
console.log(`Wrote ${REVIEW_PATH.pathname}`);
console.log(`Schemas (${manifest.schemas.length}): ${manifest.schemas.map((s) => s.name).join(', ')}`);
