export type RoasteryCommand = "validate" | "project-index" | "contract-digest";
export interface NotImplementedResult {
    command: RoasteryCommand;
    status: "not_implemented";
}
export declare function validate(): NotImplementedResult;
export declare function projectIndex(): NotImplementedResult;
export declare function contractDigest(): NotImplementedResult;
