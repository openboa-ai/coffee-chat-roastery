import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, } from "node:fs";
import { resolve } from "node:path";
export class UnsafeReadError extends Error {
    code;
    constructor(code) {
        super(code);
        this.name = "UnsafeReadError";
        this.code = code;
    }
}
function fail(code) {
    throw new UnsafeReadError(code);
}
function sameEntry(left, right) {
    return (left.dev === right.dev &&
        left.ino === right.ino &&
        left.size === right.size &&
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs);
}
function verifyDirectory(identity, code) {
    const current = lstatSync(identity.path);
    if (current.isSymbolicLink() ||
        !current.isDirectory() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino ||
        current.size !== identity.size ||
        current.mtimeMs !== identity.mtimeMs ||
        current.ctimeMs !== identity.ctimeMs ||
        realpathSync(identity.path) !== identity.realPath) {
        fail(code);
    }
}
function verifyFile(identity, code) {
    const current = lstatSync(identity.path);
    if (current.isSymbolicLink() ||
        !current.isFile() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino ||
        current.size !== identity.size ||
        current.mtimeMs !== identity.mtimeMs ||
        current.ctimeMs !== identity.ctimeMs ||
        realpathSync(identity.path) !== identity.realPath) {
        fail(code);
    }
}
export function verifyDirectories(identities, code) {
    try {
        for (const identity of identities)
            verifyDirectory(identity, code);
    }
    catch (error) {
        if (error instanceof UnsafeReadError)
            throw error;
        fail(code);
    }
}
export function verifyFiles(identities, code) {
    try {
        for (const identity of identities)
            verifyFile(identity, code);
    }
    catch (error) {
        if (error instanceof UnsafeReadError)
            throw error;
        fail(code);
    }
}
export function captureDirectory(path, ancestors, code) {
    let descriptor;
    try {
        verifyDirectories(ancestors, code);
        const absolute = resolve(path);
        descriptor = openSync(absolute, constants.O_RDONLY |
            (constants.O_DIRECTORY ?? 0) |
            (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(descriptor);
        const current = lstatSync(absolute);
        if (!opened.isDirectory() ||
            !current.isDirectory() ||
            current.isSymbolicLink() ||
            !sameEntry(opened, current)) {
            fail(code);
        }
        const identity = {
            ctimeMs: opened.ctimeMs,
            dev: opened.dev,
            ino: opened.ino,
            mtimeMs: opened.mtimeMs,
            path: absolute,
            realPath: realpathSync(absolute),
            size: opened.size,
        };
        verifyDirectories(ancestors, code);
        verifyDirectory(identity, code);
        return identity;
    }
    catch (error) {
        if (error instanceof UnsafeReadError)
            throw error;
        fail(code);
    }
    finally {
        if (descriptor !== undefined)
            closeSync(descriptor);
    }
    throw new UnsafeReadError(code);
}
export function readVerifiedFile(path, ancestors, files, code) {
    let descriptor;
    try {
        verifyDirectories(ancestors, code);
        const absolute = resolve(path);
        descriptor = openSync(absolute, constants.O_RDONLY |
            (constants.O_NONBLOCK ?? 0) |
            (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(descriptor);
        const current = lstatSync(absolute);
        if (!opened.isFile() ||
            !current.isFile() ||
            current.isSymbolicLink() ||
            !sameEntry(opened, current)) {
            fail(code);
        }
        const identity = {
            ctimeMs: opened.ctimeMs,
            dev: opened.dev,
            ino: opened.ino,
            mtimeMs: opened.mtimeMs,
            path: absolute,
            realPath: realpathSync(absolute),
            size: opened.size,
        };
        verifyDirectories(ancestors, code);
        const content = readFileSync(descriptor);
        const afterRead = fstatSync(descriptor);
        if (!sameEntry(opened, afterRead))
            fail(code);
        verifyDirectories(ancestors, code);
        verifyFile(identity, code);
        files.push(identity);
        return content;
    }
    catch (error) {
        if (error instanceof UnsafeReadError)
            throw error;
        fail(code);
    }
    finally {
        if (descriptor !== undefined)
            closeSync(descriptor);
    }
    throw new UnsafeReadError(code);
}
