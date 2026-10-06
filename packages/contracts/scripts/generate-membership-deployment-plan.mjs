// Emits membership/deployment-plan.json: the reviewable plan for deploying the
// three Colosseum membership contracts and wiring them, in the same shape as
// the EAS registration-calldata generator.
//
// SAFETY: no network access, no signing, no broadcast, and no private key is
// read or written. The project owner deploys and executes the Safe call from
// their own account. Every result is `sent: false`. This script fails closed
// when the required inputs are absent, and it has no broadcast mode.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  EXAMPLE_INPUTS_PATH,
  loadMembershipDeploymentInputs,
} from './membership-deployment-inputs.mjs';
import {
  MEMBERSHIP_DEPLOY_ORDER,
  buildMembershipDeploymentPlan,
} from './membership-deployment-plan.mjs';

export const PLAN_PATH = new URL('../membership/deployment-plan.json', import.meta.url);

const ARTIFACT_PATHS = {
  MembershipManager: new URL(
    '../out/MembershipManager.sol/MembershipManager.json',
    import.meta.url,
  ),
  ColosseumResident: new URL(
    '../out/ColosseumResident.sol/ColosseumResident.json',
    import.meta.url,
  ),
  ColosseumCitizen: new URL(
    '../out/ColosseumCitizen.sol/ColosseumCitizen.json',
    import.meta.url,
  ),
};

function rejectArguments(argv) {
  const args = argv.slice(2);
  if (args.length > 0) {
    throw new Error(
      `This planner accepts no arguments and never broadcasts. Received: ${args.join(' ')}`,
    );
  }
}

function readArtifacts() {
  const artifacts = {};
  for (const name of MEMBERSHIP_DEPLOY_ORDER) {
    let raw;
    try {
      raw = readFileSync(ARTIFACT_PATHS[name], 'utf8');
    } catch {
      throw new Error(
        `The compiled artifact for ${name} is missing at ${ARTIFACT_PATHS[name].pathname}. ` +
          'Run `forge build` first; this planner never deploys.',
      );
    }
    const parsed = JSON.parse(raw);
    const creationCode = parsed?.bytecode?.object;
    if (typeof creationCode !== 'string' || creationCode.length <= 2) {
      throw new Error(`The ${name} artifact carries no creation code.`);
    }
    artifacts[name] = { creationCode };
  }
  return artifacts;
}

const comment = () =>
  'PLAN ONLY — NO TRANSACTION HAS BEEN SENT. Reviewable plan for the Colosseum ' +
  'membership deployment: deploy order, constructor arguments, predicted CREATE ' +
  'addresses (when the deployer nonce is supplied) and the exact calldata, ' +
  'followed by the Safe\'s one-time setCollections(resident, citizen). The ' +
  'project owner deploys and executes the Safe call from their own account; no ' +
  'script in this repository has a broadcast mode.';

function main() {
  rejectArguments(process.argv);
  const inputs = loadMembershipDeploymentInputs();
  const artifacts = readArtifacts();
  const plan = buildMembershipDeploymentPlan({ ...inputs, artifacts });

  const document = {
    $comment: comment(),
    $inputs: {
      source: 'membership/deployment-inputs.json (or KADE_MEMBERSHIP_DEPLOYMENT_INPUTS)',
      example: EXAMPLE_INPUTS_PATH.pathname,
    },
    ...plan,
  };

  writeFileSync(PLAN_PATH, `${JSON.stringify(document, null, 2)}\n`);

  console.log('Colosseum membership deployment plan');
  console.log(`Target: ${plan.target.chainName} (chain ${plan.target.chainId}), rpc host ${plan.target.rpcHost}`);
  console.log(`Deployer: ${plan.deployer}`);
  console.log(`Safe (manager owner): ${plan.safe}`);
  console.log(`Address prediction: ${plan.addressPrediction}`);
  console.log('');
  for (const stage of plan.stages) {
    console.log(`${stage.order}. ${stage.contract}`);
    console.log(`   constructor: ${stage.constructorArgs.map((a) => `${a.name}=${a.value ?? '(depends on a prior stage)'}`).join(', ')}`);
    console.log(`   predicted:   ${stage.predictedAddress ?? '(unknown without deployerNonce)'}`);
    console.log(`   calldata:    ${stage.calldata ?? '(depends on a prior stage)'}`);
  }
  console.log(`${plan.wiringStage.order}. ${plan.wiringStage.contract}.${plan.wiringStage.function} (caller ${plan.wiringStage.caller})`);
  console.log(`   args:        ${plan.wiringStage.args.map((a) => `${a.name}=${a.value ?? '(depends on a prior stage)'}`).join(', ')}`);
  console.log(`   calldata:    ${plan.wiringStage.calldata ?? '(depends on a prior stage)'}`);
  console.log('');
  console.log(`Wrote ${PLAN_PATH.pathname}`);
  console.log('This script sent nothing and deployed nothing.');
}

main();
