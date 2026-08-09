import type { Bean } from "../contract/types.ts";
export type BeanValidationResult = {
    status: "valid";
    bean: Bean;
} | {
    status: "invalid";
    reason: string;
};
export type StructuralValidator = (value: unknown) => boolean;
export declare function isLowercaseUuidV7(value: string): boolean;
export declare function validateBeanFile(relativePath: string, bytes: Uint8Array, validateStructure?: StructuralValidator): BeanValidationResult;
