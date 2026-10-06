import { describe, expect, it } from 'vitest';
import { getContractAddress } from 'viem';
import {
  MEMBERSHIP_DEPLOY_ORDER,
  buildMembershipDeploymentPlan,
} from '../../../packages/contracts/scripts/membership-deployment-plan.mjs';

/**
 * The membership deployment plan (pure computation).
 *
 * The plan is a reviewable artifact, never a broadcast: every result is
 * `sent: false`, the deploy order is fixed, and the exact calldata is produced
 * from the compiled creation code. When the deployer nonce is supplied the
 * CREATE addresses are predicted deterministically; when it is not, addresses
 * and dependent calldata are reported unknown rather than guessed.
 */

const DEPLOYER = '0x1111111111111111111111111111111111111111';
const SAFE = '0x9999999999999999999999999999999999999999';

// Synthetic creation code; the real generator reads the forge artifacts.
const ARTIFACTS = {
  MembershipManager: { creationCode: '0x60016002' },
  ColosseumResident: { creationCode: '0x60036004' },
  ColosseumCitizen: { creationCode: '0x60056006' },
};

const SET_COLLECTIONS_SELECTOR = '0x7f743bc6';

// `encodeAbiParameters` lowercases an address argument, so the expected calldata
// is built from the lowercased, left-padded 20-byte value.
const padded = (address: string) => address.slice(2).toLowerCase().padStart(64, '0');

function build(overrides: Record<string, unknown> = {}) {
  return buildMembershipDeploymentPlan({
    chainId: 11155111,
    chainName: 'Ethereum Sepolia',
    rpcUrl: 'https://sepolia.example.invalid/v3/SECRET',
    deployer: DEPLOYER,
    safe: SAFE,
    deployerNonce: 7,
    artifacts: ARTIFACTS,
    ...overrides,
  });
}

describe('buildMembershipDeploymentPlan', () => {
  it('is always an unsent plan with the fixed deploy order', () => {
    const plan = build();
    expect(plan.sent).toBe(false);
    expect(plan.deployOrder).toEqual(MEMBERSHIP_DEPLOY_ORDER);
    expect(plan.stages.map((stage) => stage.contract)).toEqual([
      'MembershipManager',
      'ColosseumResident',
      'ColosseumCitizen',
    ]);
    expect(plan.wiringStage.function).toBe('setCollections');
  });

  it('records only the RPC host, never the endpoint key', () => {
    const plan = build();
    expect(plan.target.rpcHost).toBe('sepolia.example.invalid');
    expect(JSON.stringify(plan)).not.toContain('SECRET');
  });

  it('sets the Safe as the manager constructor argument', () => {
    const plan = build();
    const manager = plan.stages[0];
    expect(manager?.constructorArgs).toEqual([{ name: 'initialOwner', value: SAFE }]);
    expect(manager?.calldata).toBe(`0x60016002${padded(SAFE)}`);
  });

  it('predicts the CREATE addresses deterministically from the deployer nonce', () => {
    const plan = build();
    expect(plan.addressPrediction).toBe('create');
    expect(plan.stages[0]?.predictedAddress).toBe(
      getContractAddress({ from: DEPLOYER, nonce: 7n }),
    );
    expect(plan.stages[1]?.predictedAddress).toBe(
      getContractAddress({ from: DEPLOYER, nonce: 8n }),
    );
    expect(plan.stages[2]?.predictedAddress).toBe(
      getContractAddress({ from: DEPLOYER, nonce: 9n }),
    );
  });

  it('encodes the Safe setCollections(resident, citizen) call', () => {
    const plan = build();
    const resident = getContractAddress({ from: DEPLOYER, nonce: 8n });
    const citizen = getContractAddress({ from: DEPLOYER, nonce: 9n });
    expect(plan.wiringStage.caller).toBe(SAFE);
    expect(plan.wiringStage.calldata).toBe(
      `${SET_COLLECTIONS_SELECTOR}${padded(resident)}${padded(citizen)}`,
    );
  });

  it('reports addresses and dependent calldata as unknown without the nonce', () => {
    const plan = build({ deployerNonce: null });
    expect(plan.addressPrediction).toBe('unavailable');
    expect(plan.stages[0]?.predictedAddress).toBeNull();
    // The manager can still be deployed, but the collections depend on its address.
    expect(plan.stages[0]?.calldata).not.toBeNull();
    expect(plan.stages[1]?.calldata).toBeNull();
    expect(plan.stages[1]?.dependsOn).toBe('MembershipManager');
    expect(plan.wiringStage.calldata).toBeNull();
  });

  it('fails closed on a missing creation code', () => {
    expect(() =>
      build({ artifacts: { ...ARTIFACTS, ColosseumCitizen: undefined } }),
    ).toThrow(/creation code is missing/);
  });

  it('fails closed on a malformed deployer address', () => {
    expect(() => build({ deployer: 'nope' })).toThrow(/deployer/);
  });

  it('notes that re-enabling Arbitrum is a human decision', () => {
    const plan = build();
    expect(plan.notes.join(' ')).toMatch(/Arbitrum is marked active: false/);
  });
});
