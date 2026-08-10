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
export interface FileIdentity extends DirectoryIdentity {
}
export declare function verifyDirectories(identities: DirectoryIdentity[], code: string): void;
export declare function verifyFiles(identities: FileIdentity[], code: string): void;
export declare function captureDirectory(path: string, ancestors: DirectoryIdentity[], code: string): DirectoryIdentity;
export declare function readVerifiedFile(path: string, ancestors: DirectoryIdentity[], files: FileIdentity[], code: string): Buffer;
