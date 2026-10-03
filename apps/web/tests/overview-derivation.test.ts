import { describe, expect, it } from 'vitest';
import {
  buildOverview,
  demoBadgeLabel,
  type OverviewFee,
  type OverviewInput,
  type OverviewModel,
} from '@/lib/review/overview';

/**
 * The Overview dashboard's content is **derived**, not declared (T43).
 *
 * The screen used to render a fixed stage list and literal dollars ("$0",
 * "$425,000 to 5-year tier", "1.75 USDC", "3"). These tests drive the pure
 * derivation directly, so they pin the honesty rules without a database or a
 * network:
 *
 *   - a real qualified figure is rendered, and it is the injected figure (so it
 *     can never have been written into the source);
 *   - an unknown read is `—` plus its specific reason, never a fabricated `$0`;
 *   - a genuine zero is a real `$0`, distinct from unknown;
 *   - a stage with no source says so instead of inventing a status;
 *   - the honesty chip is derived, and is not shown when nothing is demo data.
 */

function paidFee(): OverviewFee {
  return { status: 'paid', txHash: '0x00' as `0x${string}` };
}

function input(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    gate: 'pending',
    tier: '3-year',
    preapprovalUsdc: 1.75,
    fee: paidFee(),
    reviewUid: null,
    serviceUid: null,
    safeAddress: '0x5Af1000000000000000000000000000000000c09D',
    safeDeployed: true,
    qualified: { status: 'known', usd: 403216 },
    preapprovalPaid: true,
    ...overrides,
  };
}

function stat(model: OverviewModel, label: string) {
  const found = model.stats.find((s) => s.label === label);
  if (!found) throw new Error(`no stat ${label}`);
  return found;
}

function stage(model: OverviewModel, title: string) {
  const found = model.stages.find((s) => s.title === title);
  if (!found) throw new Error(`no stage ${title}`);
  return found;
}

/** Every piece of text the model renders, for literal-hunting assertions. */
function rendered(model: OverviewModel): string {
  return [
    ...model.stats.map((s) => `${s.value} ${s.sub}`),
    ...model.stages.map((s) => `${s.meta} ${s.status}`),
    ...model.steps.map((s) => `${s.label} ${s.note}`),
    model.holdings.value,
    model.holdings.sub,
  ].join(' ');
}

describe('the Overview money figure', () => {
  it('renders the injected qualified value and never a literal one written into the source', () => {
    // No tier and no fee amount, so the only dollar figures are the injected
    // qualified one. If the screen carried a literal, one of these would not
    // track the input.
    const a = buildOverview(
      input({ tier: null, fee: { status: 'none' }, qualified: { status: 'known', usd: 111111 } }),
    );
    const b = buildOverview(
      input({ tier: null, fee: { status: 'none' }, qualified: { status: 'known', usd: 222222 } }),
    );

    expect(stat(a, 'Qualifying balance').value).toBe('$111,111');
    expect(stat(b, 'Qualifying balance').value).toBe('$222,222');
    expect(a.holdings.value).toBe('$111,111');

    // None of the reference's literal figures survive.
    for (const model of [a, b]) {
      expect(rendered(model)).not.toContain('$425,000');
      expect(rendered(model)).not.toContain('$280,000');
    }

    // The fee amount tracks the stored value rather than a source literal.
    expect(
      stat(
        buildOverview(input({ preapprovalUsdc: 2.5 })),
        'Fees paid onchain',
      ).value,
    ).toBe('2.5 USDC');

    // The tier is named from the application row, and its minimum comes from
    // the shared table (so a funded resident sees no bare min figure).
    const funded = buildOverview(
      input({ tier: '3-year', qualified: { status: 'known', usd: 300000 } }),
    );
    expect(stat(funded, 'Qualifying balance').sub).toContain('3-year');
    expect(rendered(funded)).not.toContain('$280,000');
  });

  it('shows an unknown read as — with its specific reason, never a fabricated $0', () => {
    const reason = 'The vault balance on Ethereum could not be read.';
    const model = buildOverview(
      input({ qualified: { status: 'unknown', reason } }),
    );

    expect(stat(model, 'Qualifying balance').value).toBe('—');
    expect(stat(model, 'Qualifying balance').sub).toBe(reason);
    expect(model.holdings.value).toBe('—');
    expect(model.holdings.sub).toBe(reason);
    expect(stage(model, 'Qualified holdings funded').meta).toBe(reason);
    expect(stage(model, 'Qualified holdings funded').status).toBe('Unread');

    // No stat turns the unknown into a figure.
    expect(model.stats.every((s) => s.value !== '$0')).toBe(true);
  });

  it('treats a genuine empty Safe as a real $0, distinct from unknown', () => {
    const empty = buildOverview(input({ qualified: { status: 'known', usd: 0 } }));
    expect(stat(empty, 'Qualifying balance').value).toBe('$0');
    expect(empty.holdings.sub).toBe('Safe deployed · no qualified holdings yet');

    const unknown = buildOverview(
      input({ qualified: { status: 'unknown', reason: 'not read' } }),
    );
    expect(stat(unknown, 'Qualifying balance').value).toBe('—');
  });

  it('shows no Safe as unknown with the specific reason', () => {
    const model = buildOverview(
      input({
        safeAddress: null,
        safeDeployed: false,
        qualified: {
          status: 'unknown',
          reason:
            'No Safe is recorded for this account, so its vault position could not be read.',
        },
      }),
    );
    expect(stat(model, 'Qualifying balance').value).toBe('—');
    expect(stat(model, 'Qualifying balance').sub).toContain('No Safe is recorded');
  });
});

describe('the Overview stages and steps are derived', () => {
  it('reflects the fee state rather than a fixed "fee paid" claim', () => {
    const none = buildOverview(input({ fee: { status: 'none' } }));
    expect(stage(none, 'Fee paid · account pre-approved').status).toBe(
      'In progress',
    );
    expect(stage(none, 'Fee paid · account pre-approved').meta).toBe(
      'Not paid yet',
    );

    const paid = buildOverview(input());
    expect(stage(paid, 'Fee paid · account pre-approved').state).toBe('done');
    expect(stat(paid, 'Fees paid onchain').value).toBe('1.75 USDC');
  });

  it('reflects the review gate', () => {
    expect(stage(buildOverview(input({ gate: 'approved' })), 'Intake review').status)
      .toBe('Approved');
    expect(stage(buildOverview(input({ gate: 'blocked' })), 'Intake review').status)
      .toBe('Blocked');
    expect(stage(buildOverview(input({ gate: 'unknown' })), 'Intake review').status)
      .toBe('Unread');
  });

  it('says a stage has no source on this screen instead of inventing a status', () => {
    const model = buildOverview(input());
    const identity = stage(model, 'Identity verified');
    expect(identity.meta).toContain('Not read on this screen');
    expect(identity.status).toBe('See Residency');
  });

  it('quotes no service-fee figure and derives the tracker from the records', () => {
    const model = buildOverview(input());
    expect(model.stages.every((s) => !s.title.includes('2,000'))).toBe(true);
    // The real end-to-end tracker: profile, fee, identity, funds, documents,
    // intake review, service fee, start residency. The Colosseum rows are only
    // added when demo progress is passed in.
    expect(model.stages.map((s) => s.title)).toEqual([
      'Profile, household & proof of wealth',
      'Fee paid · account pre-approved',
      'Identity verified',
      'Qualified holdings funded',
      'Documents complete',
      'Intake review',
      'Residency service fee',
      'Start Residency',
    ]);
  });

  it('drops "move funds" once the tier is met and keeps it with the real shortfall until then', () => {
    const funded = buildOverview(
      input({ tier: '3-year', qualified: { status: 'known', usd: 300000 } }),
    );
    expect(funded.steps.map((s) => s.label)).not.toContain(
      'Move funds into the qualified vault',
    );

    const short = buildOverview(
      input({ tier: '5-year', qualified: { status: 'known', usd: 100000 } }),
    );
    const move = short.steps.find(
      (s) => s.label === 'Move funds into the qualified vault',
    );
    // 425,000 - 100,000, from the shared tier minimum.
    expect(move?.note).toBe('$325,000 to go');
  });

  it('reflects the review gate in the card action', () => {
    const approved = buildOverview(input({ gate: 'approved' }));
    expect(
      approved.steps.find((s) => s.label === 'Order Onchain Island Card')?.note,
    ).toBe('Available');
    const pending = buildOverview(input({ gate: 'pending' }));
    expect(
      pending.steps.find((s) => s.label === 'Order Onchain Island Card')?.note,
    ).toBe('Unlocks after the intake review');
  });
});

describe('the honesty chip', () => {
  it('is absent when nothing is demo data', () => {
    expect(demoBadgeLabel(buildOverview(input()))).toBeNull();
  });

  it('is present while a block is still demo data, so it cannot be dropped early', () => {
    const model = buildOverview(input());
    const withDemo: OverviewModel = {
      ...model,
      stats: [
        { ...model.stats[0]!, provenance: 'demo' },
        ...model.stats.slice(1),
      ],
    };
    expect(demoBadgeLabel(withDemo)).toBe(
      'Demo data · not this resident’s records',
    );
  });
});

describe('the Overview residency tracker reflects the real flow', () => {
  it('marks identity done only when a kyc UID is present, and says so otherwise', () => {
    // The default input carries no kyc UID: the Overview does not read Self, so
    // the row must not claim a verification.
    const notRead = stage(buildOverview(input()), 'Identity verified');
    expect(notRead.state).toBe('queued');
    expect(notRead.provenance).toBe('unknown');
    expect(notRead.meta).toContain('Not read on this screen');

    const read = stage(
      buildOverview(input({ kycUid: '0xabc' })),
      'Identity verified',
    );
    expect(read.state).toBe('done');
    expect(read.status).toBe('Verified');
    expect(read.provenance).toBe('record');
  });

  it('carries the documents flag as a declared demo done, never a false done', () => {
    expect(stage(buildOverview(input()), 'Documents complete').state).toBe(
      'queued',
    );
    const done = stage(
      buildOverview(input({ documentsComplete: true })),
      'Documents complete',
    );
    expect(done.state).toBe('done');
    expect(done.provenance).toBe('demo');
  });

  it('ties Start Residency to the permit/service-fee milestones instead of always-queued', () => {
    const queued = stage(
      buildOverview(
        input({ serviceUid: null, preapprovalPaid: false, serviceFeeUnlocked: false }),
      ),
      'Start Residency',
    );
    expect(queued.state).toBe('queued');

    const inProgress = stage(
      buildOverview(
        input({
          serviceUid: null,
          fee: paidFee(),
          serviceFeeUnlocked: true,
        }),
      ),
      'Start Residency',
    );
    expect(inProgress.state).toBe('active');

    const submitted = stage(
      buildOverview(input({ serviceUid: '0xpermit', serviceFeeUnlocked: true })),
      'Start Residency',
    );
    expect(submitted.state).toBe('done');
    expect(submitted.status).toBe('Submitted');
  });

  it('adds the Colosseum resident/citizen rows from the persisted demo progress and flags them demo', () => {
    const noProgress = buildOverview(input());
    expect(noProgress.stages.map((s) => s.title)).not.toContain(
      'Colosseum Resident',
    );

    const resident = buildOverview(
      input({
        colosseum: {
          residentSince: '2026-01-01T00:00:00.000Z',
          citizenAt: null,
          passportSerial: null,
        },
      }),
    );
    const residentRow = stage(resident, 'Colosseum Resident');
    expect(residentRow.state).toBe('active');
    expect(residentRow.provenance).toBe('demo');
    expect(stage(resident, 'Colosseum Citizen').state).toBe('queued');

    const citizen = buildOverview(
      input({
        colosseum: {
          residentSince: '2026-01-01T00:00:00.000Z',
          citizenAt: '2026-01-01T00:02:00.000Z',
          passportSerial: 'KADE-CL-ABCD2345',
        },
      }),
    );
    expect(stage(citizen, 'Colosseum Citizen').state).toBe('done');
    expect(stage(citizen, 'Colosseum Citizen').meta).toContain(
      'KADE-CL-ABCD2345',
    );
    // The demo rows turn the honesty chip on so they cannot pose as records.
    expect(demoBadgeLabel(citizen)).toBe('Demo data · not this resident’s records');
  });
});

describe('the Attestations stat is honest about what is tracked', () => {
  it('counts only issued UIDs and names the gate-blocked ones as pending approval', () => {
    const none = stat(buildOverview(input({ preapprovalPaid: false })), 'Attestations');
    expect(none.value).toBe('0');
    expect(none.sub).toContain('Pending approval: kade.review.v1');
    expect(none.sub).toContain('kade.kyc.v1');
    expect(none.sub).toContain('kade.permit.v1');
    expect(none.tone).toBe('muted');

    const permitOnly = stat(
      buildOverview(
        input({ serviceUid: '0xpermit', preapprovalPaid: false }),
      ),
      'Attestations',
    );
    expect(permitOnly.value).toBe('1');
    expect(permitOnly.sub).toContain('Issued: kade.permit.v1');
    expect(permitOnly.sub).toContain('Pending approval: kade.review.v1');
  });

  it('records the fee attestation only when the pre-approval fee is verified', () => {
    const notPaid = stat(
      buildOverview(input({ preapprovalPaid: false, preapprovalUsdc: 1.75 })),
      'Attestations',
    );
    expect(notPaid.sub).not.toContain('Fee attestation');

    const paid = stat(
      buildOverview(input({ preapprovalPaid: true, preapprovalUsdc: 1.75 })),
      'Attestations',
    );
    expect(paid.value).toBe('1');
    expect(paid.sub).toContain('Fee attestation recorded (1.75 USDC)');
  });
});
