// Renders the Onchain gate review pack (eas/REVIEW.md) from the generated
// manifest.
//
// The pack exists so a human can approve the exact EAS encodings in one pass
// before any irreversible registration (week-1-frozen-delivery-contract.md
// section 4, D6, and section 7, checkpoint 3). The schema strings and field
// tables are taken from the manifest, which is itself generated from
// @kade/shared; nothing here is hand-copied.
//
// Rendering only: no network access, no signing, no writes beyond REVIEW.md.
import { readFileSync } from 'node:fs';

export const DEFAULT_APPROVAL_PATH = new URL('../eas/approval.json', import.meta.url);

function provenanceLabel(provenance) {
  return provenance === 'arbitrary' ? '[arbitrary]' : provenance;
}

// Reads the approval record without asserting it, so the pack can be rendered
// while the gate is still unapproved.
function readApproval(approvalPath) {
  let raw;
  try {
    raw = readFileSync(approvalPath, 'utf8');
  } catch {
    return { onchainGateApproved: false, approvedBy: '', approvedAt: '' };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { onchainGateApproved: false, approvedBy: '', approvedAt: '' };
  }
}

function approvalLine(approval) {
  if (approval.onchainGateApproved) {
    return `approved by ${approval.approvedBy} at ${approval.approvedAt}`;
  }
  return 'not approved (Onchain gate checkpoint 3 has not been recorded)';
}

function revocableConsequence(revocable) {
  return revocable
    ? 'Attestations can be revoked by the attester, so Kade can retract or supersede an attestation.'
    : 'Attestations are permanent; a mistaken or superseded attestation cannot be retracted on-chain.';
}

function resolverConsequence(resolver) {
  return resolver
    ? `EAS calls resolver \`${resolver}\` on every attest and revoke. That contract's logic and authority must be reviewed separately.`
    : 'No resolver is called. The schema is written directly, with no on-chain validation, fee or side effect on attest or revoke.';
}

function attesterConsequence(attester) {
  if (attester === 'kade-authorized') {
    return (
      'The registry does not enforce an attester. This is an off-chain rule: only ' +
      "the account the project authorises is expected to attest. Consumers MUST " +
      'filter by the approved attester address; otherwise any address can attest ' +
      'to this public schema.'
    );
  }
  return (
    'Any address may attest; registration implies no authorisation. Consumers ' +
    'must not treat this schema as an authorisation boundary.'
  );
}

function recipientConsequence(recipient) {
  if (recipient === 'resident-safe' || recipient === 'treasury-safe') {
    const safe = recipient === 'resident-safe' ? 'resident Safe' : 'treasury Safe';
    return (
      `The recipient is chosen at attestation time, not at registration. This ` +
      `records Kade's intended recipient (the ${safe}); the registry does not ` +
      'enforce it. Consumers MUST check the recipient.'
    );
  }
  return (
    'The recipient is chosen at attestation time, not at registration and is not ' +
    'enforced by the registry. Consumers must check the recipient.'
  );
}

function schemaSection(schema, index) {
  const rows = [
    ['revocable', String(schema.revocable), schema.provenance.revocable, revocableConsequence(schema.revocable)],
    [
      'resolver',
      schema.resolver ?? 'none (0x0000…0000)',
      schema.provenance.resolver,
      resolverConsequence(schema.resolver),
    ],
    ['attester rule', schema.attester, schema.provenance.attester, attesterConsequence(schema.attester)],
    ['recipient', schema.recipient, schema.provenance.recipient, recipientConsequence(schema.recipient)],
  ];

  const attributeTable = [
    '| Attribute | Value | Provenance | Consequence |',
    '|---|---|---|---|',
    ...rows.map(
      ([attr, value, provenance, consequence]) =>
        `| ${attr} | ${value} | ${provenanceLabel(provenance)} | ${consequence} |`,
    ),
  ].join('\n');

  const fieldTable = [
    '| # | Field | Solidity type | Type provenance |',
    '|---:|---|---|---|',
    ...schema.fields.map(
      (field, fieldIndex) =>
        `| ${fieldIndex + 1} | ${field.name} | \`${field.type}\` | ${provenanceLabel(field.provenance)} |`,
    ),
  ].join('\n');

  return [
    `### ${index}. ${schema.name}`,
    '',
    'Exact encoded string (this is what is hashed into the schema UID):',
    '',
    '```text',
    schema.schema,
    '```',
    '',
    attributeTable,
    '',
    'Fields:',
    '',
    fieldTable,
    '',
  ].join('\n');
}

function orderSection(manifest) {
  return manifest.schemas
    .map((schema, index) => {
      return [
        `${index + 1}. **${schema.name}**`,
        '',
        '   ```text',
        `   ${schema.schema}`,
        '   ```',
        '',
      ].join('\n');
    })
    .join('\n');
}

function arbitrarySection(manifest) {
  const rows = [];
  for (const schema of manifest.schemas) {
    if (schema.provenance.revocable === 'arbitrary') {
      rows.push(`| \`revocable\` (${schema.name}) | manifest | Onchain gate |`);
    }
    if (schema.provenance.resolver === 'arbitrary') {
      rows.push(`| \`resolver\` (${schema.name}) | manifest | Onchain gate |`);
    }
    if (schema.provenance.attester === 'arbitrary') {
      rows.push(`| \`attester\` (${schema.name}) | manifest | Onchain gate |`);
    }
    if (schema.provenance.recipient === 'arbitrary') {
      rows.push(`| \`recipient\` (${schema.name}) | manifest | Onchain gate |`);
    }
    for (const field of schema.fields) {
      if (field.provenance === 'arbitrary') {
        rows.push(`| \`${field.name}: ${field.type}\` (${schema.name}) | manifest | Onchain gate |`);
      }
    }
  }
  return [
    '| Value | Where | Gate that must confirm it |',
    '|---|---|---|',
    ...rows,
    `| Registration account (not in the manifest) | project supply | Onchain gate + project |`,
    `| \`SEPOLIA_RPC_URL\` | environment | Foundation / ops |`,
  ].join('\n');
}

export function buildReviewMarkdown(manifest, approvalPath = DEFAULT_APPROVAL_PATH) {
  const approval = readApproval(approvalPath);

  return `# Onchain gate review — EAS schema registration

<!-- GENERATED FILE. Do not edit by hand. Regenerate with
     npm run eas:manifest --workspace @kade/contracts -->

This is the review pack the human approves at the **Onchain gate**
(week-1-frozen-delivery-contract.md section 7, checkpoint 3) before any
irreversible EAS registration. It is generated from \`@kade/shared\`; the schema
strings below are never hand-copied.

> **Warning:** Nothing is registered. Generating, committing or reading this
> file performs no on-chain action. Registration is irreversible.

- Source of truth: \`@kade/shared registrationManifest()\`
- Target chain: ${manifest.targetChainName} (chain ${manifest.targetChainId})
- Schema registry: \`${manifest.schemaRegistry}\`
- Registration order: ${manifest.schemas.map((s) => `\`${s.name}\``).join(', ')}
- Approval record: ${approvalLine(approval)}

## 1. The irreversible action approval authorises

Approving this pack authorises **one** thing: registering the five exact schema
strings below, once each, against the EAS SchemaRegistry at
\`${manifest.schemaRegistry}\` on ${manifest.targetChainName}, from the project's
authorised Sepolia EAS registration account.

The command a human runs is:

\`\`\`bash
npm run eas:register --workspace @kade/contracts
\`\`\`

It **never signs or sends a transaction**. It prints the exact
\`register(string,address,bool)\` calldata for each schema, which the authorised
account then executes manually. No script in this repository has a broadcast
mode. Registration takes effect only when that manual transaction is mined.

Before running it, the human must record the approval in \`eas/approval.json\`
(or set \`KADE_EAS_APPROVAL_FILE\`): the planner refuses to run unless the record
sets \`onchainGateApproved: true\` and names an approver and timestamp.

## 2. Registration order and exact encodings

Field order is significant: it determines the schema UID.

${orderSection(manifest)}
## 3. Per-schema detail

Each row states the attribute, its value, its provenance and the consequence of
the value. A provenance of \`[arbitrary]\` means the value is not fixed by the
governing documents and must be confirmed at the Onchain gate.

${manifest.schemas.map((schema, index) => schemaSection(schema, index + 1)).join('\n')}
> **Note:** the EAS \`register\` call takes only \`(schema, resolver, revocable)\`.
> \`attester\` and \`recipient\` are therefore **not** enforced by registration.
> They are recorded here as the intended off-chain rules, and consumers must
> enforce them.

## 4. What approval does NOT authorise

- Deployment of KadeLock. It is compiled and Foundry-tested only in Week 1
  (contract sections 6.2 and 9).
- Deployment or configuration of the resident Safe, or any change to the Safe
  version, factory, singleton, initializer, handler, signer, threshold or salt.
  Those are the **Account gate** (section 7, checkpoint 2).
- Mainnet registration, or registration on any chain other than
  ${manifest.targetChainName}.
- Registration on Arbitrum Sepolia or Base Sepolia.
- Issuing, revoking or altering any EAS attestation.
- Changing the schema fields, encodings, order, \`revocable\` or \`resolver\`.
  Those are change-control items (section 8).
- Approving the registration account, the RPC provider or the deployment payer.
- Automating or broadcasting the transaction. No script here sends it.
- Waiving the read-only verification step after registration.

## 5. What could still go wrong after approval

1. **An encoding error is permanent.** The schema string is hashed into the UID
   and cannot be edited. A typo or wrong field order requires a new schema
   version with a new UID.
2. **A wrong \`revocable\` flag is permanent.** Setting it false makes every
   attestation impossible to retract.
3. **A resolver cannot be added later.** Registering with no resolver means no
   on-chain hook on attest or revoke; adding one requires a new schema and UID.
4. **The predicted UID may already exist.** If the same
   \`(schema, resolver, revocable)\` triple is already registered, the
   registration transaction reverts; compare the registry before executing.
5. **The registry does not enforce attester or recipient.** Any address can
   attest to a public schema; consumers must filter. This is not fixed by
   approval.
6. **A front-run is possible.** Another account could register the identical
   triple first; the UID is unchanged, but Kade would not be the registering
   account and the call would revert.
7. **The registry address is an assumption.** \`${manifest.schemaRegistry}\` is
   the published EAS Sepolia deployment; a wrong or upgraded address would send
   the transaction elsewhere.
8. **Approval can go stale.** If the manifest is regenerated after approval and
   the encodings change, the recorded approval no longer covers them. The
   registration planner refuses to run if the committed manifest drifts from
   \`@kade/shared\`, but the human record itself must be re-checked.
9. **Field order binds downstream code.** Indexers and encoders must consume
   fields in exactly this order.

## 6. \`[arbitrary]\` values awaiting the Onchain gate

${arbitrarySection(manifest)}

Documented (not arbitrary): the five schema names, the target chain
${manifest.targetChainId}, the SchemaRegistry address's external source, and the
intended recipient categories. See
\`docs/architecture/kadelock-threat-model.md\` section 8 for the consolidated
list.
`;
}

export function serializeReview(markdown) {
  return markdown.endsWith('\n') ? markdown : `${markdown}\n`;
}
