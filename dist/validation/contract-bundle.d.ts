import { type ValidateFunction } from "ajv/dist/2020.js";
import { type ContractManifest } from "../contract/manifest.ts";
import { type ContentLicensePolicy, type Sha256Digest } from "../contract/types.ts";
export interface StructuralValidators {
    roastery: ValidateFunction;
    index: ValidateFunction;
    beanFrontmatter: ValidateFunction;
    contentLicense: ValidateFunction;
}
export interface ValidatedContractBundle {
    digest: Sha256Digest;
    inventory: string[];
    manifest: ContractManifest;
    policy: ContentLicensePolicy;
    schemas: StructuralValidators;
    validation: "passed";
}
export declare function validateContractBundle(root: string, declarationBytes?: Uint8Array): Promise<ValidatedContractBundle>;
