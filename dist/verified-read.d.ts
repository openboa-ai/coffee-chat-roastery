export declare class UnsafeReadError extends Error {
    readonly code: string;
    constructor(code: string);
}
export interface DirectoryIdentity {
    ctimeMs: number;
    dev: number;
    ino: number;
    mtimeMs: number;
    path: string;
    realPath: string;
    size: number;
}
export declare function verifyDirectories(identities: DirectoryIdentity[], code: string): void;
export declare function captureDirectory(path: string, ancestors: DirectoryIdentity[], code: string): DirectoryIdentity;
export declare function readVerifiedFile(path: string, ancestors: DirectoryIdentity[], code: string): Buffer;
