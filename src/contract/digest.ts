import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { Sha256Digest } from "./types.ts";
import { requireNoFollowPath } from "../validation/filesystem.ts";

interface BundleFile {
  path: string;
  bytes: Buffer;
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function uint64(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

async function collectRegularFiles(
  contractRoot: string,
  directory: string,
): Promise<BundleFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: BundleFile[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `contract bundle contains a symbolic link: ${entry.name}`,
      );
    }
    if (metadata.isDirectory()) {
      files.push(...(await collectRegularFiles(contractRoot, absolutePath)));
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(
        `contract bundle contains a non-regular file: ${entry.name}`,
      );
    }
    const relativePath = relative(contractRoot, absolutePath)
      .split(sep)
      .join("/");
    if (relativePath.startsWith("../") || relativePath === "..") {
      throw new Error("contract bundle path escaped its root");
    }
    files.push({ path: relativePath, bytes: await readFile(absolutePath) });
  }

  return files;
}

export async function digestContractBundle(
  repositoryRoot: string,
): Promise<Sha256Digest> {
  const contractRoot = resolve(repositoryRoot, "contract");
  await requireNoFollowPath(repositoryRoot, "contract", "directory");

  const files = await collectRegularFiles(contractRoot, contractRoot);
  files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );

  const hash = createHash("sha256");
  hash.update(uint32(files.length));
  for (const file of files) {
    const pathBytes = Buffer.from(file.path, "utf8");
    hash.update(uint32(pathBytes.length));
    hash.update(pathBytes);
    hash.update(uint64(file.bytes.length));
    hash.update(file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}
