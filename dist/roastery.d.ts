declare const OFFICIAL_REPOSITORY: "https://github.com/openboa-ai/coffee-chat-roastery";
export interface ContractPin {
    commit: string;
    digest: `sha256:${string}`;
    repository: typeof OFFICIAL_REPOSITORY;
}
export interface IndexEntry {
    digest: `sha256:${string}`;
    id: string;
}
export type ValidationMode = "seed" | "initialized";
export type ValidationResult = {
    beanCount: number;
    repository: string;
    status: "valid";
} | {
    code: string;
    status: "invalid";
};
export interface ProjectIndexResult {
    beans: IndexEntry[];
    bytes: string;
    status: "projected";
}
export type IndexCheckResult = {
    beans: number;
    status: "valid";
} | {
    code: string;
    status: "invalid";
};
export declare function projectIndex({ root }: {
    root: string;
}): ProjectIndexResult;
export declare function checkIndex({ root }: {
    root: string;
}): IndexCheckResult;
export declare function validate({ root, mode, expectedContract, }: {
    root: string;
    mode?: ValidationMode;
    expectedContract: ContractPin;
}): ValidationResult;
export {};
