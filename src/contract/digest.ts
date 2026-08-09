import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { contractBundlePaths, loadContractManifest } from "./manifest.ts";
import type { Sha256Digest } from "./types.ts";
import { requireNoFollowPath } from "../validation/filesystem.ts";

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

export async function digestContractBundle(
  repositoryRoot: string,
): Promise<Sha256Digest> {
  const manifest = await loadContractManifest(repositoryRoot);
  const paths = contractBundlePaths(manifest);
  const hash = createHash("sha256");
  hash.update(uint32(paths.length));

  for (const path of paths) {
    try {
      await requireNoFollowPath(repositoryRoot, path, "file");
    } catch {
      throw new Error(
        `contract bundle contains a symbolic link or non-regular file: ${path}`,
      );
    }
    const pathBytes = Buffer.from(path, "utf8");
    const content = await readFile(resolve(repositoryRoot, path));
    hash.update(uint32(pathBytes.length));
    hash.update(pathBytes);
    hash.update(uint64(content.length));
    hash.update(content);
  }

  return `sha256:${hash.digest("hex")}`;
}
