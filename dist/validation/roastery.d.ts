import { type ContractPin, type RoasteryManifest } from "../contract/types.ts";
export type RoasteryManifestValidationResult = {
    status: "valid";
    manifest: RoasteryManifest;
} | {
    status: "invalid";
    reason: string;
};
export declare function parseRepositoryIdentity(value: unknown): string | null;
export declare function validateRoasteryManifest(value: unknown, expectedContract?: ContractPin): RoasteryManifestValidationResult;
