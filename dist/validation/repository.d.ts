import { type ContractPin } from "../contract/types.ts";
export type RepositoryValidationResult = {
    status: "valid";
    repository: string;
    bean_count: number;
    contract: ContractPin;
} | {
    status: "invalid";
    reason: string;
};
export declare function validateRepository(root: string, expectedContract?: ContractPin, trustedBundleRoot?: string): Promise<RepositoryValidationResult>;
