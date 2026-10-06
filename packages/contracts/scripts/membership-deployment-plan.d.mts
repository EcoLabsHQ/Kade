// Type surface for the pure membership deployment-plan module, so a test in the
// web workspace can import it without `allowJs`. The implementation is the
// sibling `.mjs`; this file declares only what the test consumes.

export interface MembershipPlanConstructorArg {
  readonly name: string;
  readonly value: string | null;
}

export interface MembershipPlanStage {
  readonly order: number;
  readonly contract: string;
  readonly constructorArgs: readonly MembershipPlanConstructorArg[];
  readonly creationCodeHash: string;
  readonly predictedAddress: string | null;
  readonly calldata: string | null;
  readonly dependsOn: string | null;
  readonly note: string;
}

export interface MembershipWiringStage {
  readonly order: number;
  readonly contract: string;
  readonly function: string;
  readonly caller: string;
  readonly args: readonly MembershipPlanConstructorArg[];
  readonly predictedTarget: string | null;
  readonly calldata: string | null;
  readonly dependsOn: string | null;
  readonly note: string;
}

export interface MembershipDeploymentPlan {
  readonly sent: false;
  readonly target: {
    readonly chainId: number;
    readonly chainName: string;
    readonly rpcHost: string;
  };
  readonly deployer: string;
  readonly safe: string;
  readonly deployerNonce: number | null;
  readonly addressPrediction: 'unavailable' | 'create';
  readonly deployOrder: readonly string[];
  readonly stages: readonly MembershipPlanStage[];
  readonly wiringStage: MembershipWiringStage;
  readonly notes: readonly string[];
}

export declare const MEMBERSHIP_DEPLOY_ORDER: readonly string[];
export declare const SET_COLLECTIONS_ABI: readonly unknown[];

export declare function buildMembershipDeploymentPlan(input: {
  readonly chainId: number;
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly deployer: string;
  readonly safe: string;
  readonly deployerNonce?: number | null;
  readonly artifacts: Record<string, { readonly creationCode: string }>;
}): MembershipDeploymentPlan;
