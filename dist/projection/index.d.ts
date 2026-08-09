import type { RoasteryIndex } from "../contract/types.ts";
import { type StructuralValidator } from "../validation/bean.ts";
export declare function projectIndex(root: string, validateBeanStructure?: StructuralValidator): Promise<RoasteryIndex>;
export declare function projectIndexBytes(root: string, validateBeanStructure?: StructuralValidator): Promise<string>;
