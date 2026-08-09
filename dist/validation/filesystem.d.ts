export type NoFollowPathResult = "present" | "missing";
export declare function requireNoFollowPath(root: string, relativePath: string, expected: "directory" | "file", allowMissing?: boolean): Promise<NoFollowPathResult>;
