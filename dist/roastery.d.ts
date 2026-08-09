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
    status: "projected";
    wrote: boolean;
}
export declare function projectIndex({ root, write, }: {
    root: string;
    write?: boolean;
}): ProjectIndexResult;
export declare function validate({ root, mode, }: {
    root: string;
    mode: ValidationMode;
}): ValidationResult;
export {};
