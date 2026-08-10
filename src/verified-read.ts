import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { resolve } from "node:path";

export class UnsafeReadError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "UnsafeReadError";
    this.code = code;
  }
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

function fail(code: string): never {
  throw new UnsafeReadError(code);
}

function sameEntry(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function verifyDirectory(identity: DirectoryIdentity, code: string): void {
  const current = lstatSync(identity.path);
  if (
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino ||
    current.size !== identity.size ||
    current.mtimeMs !== identity.mtimeMs ||
    current.ctimeMs !== identity.ctimeMs ||
    realpathSync(identity.path) !== identity.realPath
  ) {
    fail(code);
  }
}

export function verifyDirectories(
  identities: DirectoryIdentity[],
  code: string,
): void {
  try {
    for (const identity of identities) verifyDirectory(identity, code);
  } catch (error) {
    if (error instanceof UnsafeReadError) throw error;
    fail(code);
  }
}

export function captureDirectory(
  path: string,
  ancestors: DirectoryIdentity[],
  code: string,
): DirectoryIdentity {
  let descriptor: number | undefined;
  try {
    verifyDirectories(ancestors, code);
    const absolute = resolve(path);
    descriptor = openSync(
      absolute,
      constants.O_RDONLY |
        (constants.O_DIRECTORY ?? 0) |
        (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    const current = lstatSync(absolute);
    if (
      !opened.isDirectory() ||
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      !sameEntry(opened, current)
    ) {
      fail(code);
    }
    const identity: DirectoryIdentity = {
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
  } catch (error) {
    if (error instanceof UnsafeReadError) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  throw new UnsafeReadError(code);
}

export function readVerifiedFile(
  path: string,
  ancestors: DirectoryIdentity[],
  code: string,
): Buffer {
  let descriptor: number | undefined;
  try {
    verifyDirectories(ancestors, code);
    const absolute = resolve(path);
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor);
    const current = lstatSync(absolute);
    if (
      !opened.isFile() ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      !sameEntry(opened, current)
    ) {
      fail(code);
    }
    verifyDirectories(ancestors, code);
    const content = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor);
    if (!sameEntry(opened, afterRead)) fail(code);
    verifyDirectories(ancestors, code);
    const afterPath = lstatSync(absolute);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      !sameEntry(opened, afterPath)
    ) {
      fail(code);
    }
    return content;
  } catch (error) {
    if (error instanceof UnsafeReadError) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  throw new UnsafeReadError(code);
}
