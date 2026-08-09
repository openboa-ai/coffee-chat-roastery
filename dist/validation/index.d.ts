import type { RoasteryIndex } from "../contract/types.ts";
import type { StructuralValidator } from "./bean.ts";
export type IndexValidationResult = {
    status: "valid";
    index: RoasteryIndex;
} | {
    status: "invalid";
    reason: string;
};
export declare function validateCommittedIndex(root: string, validateIndexStructure?: StructuralValidator, validateBeanStructure?: StructuralValidator): Promise<IndexValidationResult>;
