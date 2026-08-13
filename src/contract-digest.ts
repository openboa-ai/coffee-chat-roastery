import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  captureDirectory,
  readVerifiedFile,
  verifyDirectories,
  verifyFiles,
  type DirectoryIdentity,
  type FileIdentity,
} from "./verified-read.js";

const CONTRACT_FILES = [
  "README.md",
  "contract.json",
  "publication.md",
  "schemas/bean-frontmatter.schema.json",
  "schemas/content-license.schema.json",
  "schemas/index.schema.json",
  "schemas/roastery.schema.json",
  "security.md",
  "templates/content-license.md",
] as const;
const MAX_CONTRACT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONTRACT_BUNDLE_BYTES = 8 * 1024 * 1024;

function length(value: number): Buffer {
  const framed = Buffer.alloc(8);
  framed.writeBigUInt64BE(BigInt(value));
  return framed;
}

export function computeContractDigest(
  repositoryRoot: string,
): `sha256:${string}` {
  try {
    const repository = captureDirectory(
      resolve(repositoryRoot),
      [],
      "unsafe_contract_entry",
    );
    const contractRoot = resolve(repository.path, "contract");
    const root = captureDirectory(
      contractRoot,
      [repository],
      "unsafe_contract_entry",
    );
    const schemas = captureDirectory(
      resolve(contractRoot, "schemas"),
      [repository, root],
      "unsafe_contract_entry",
    );
    const templates = captureDirectory(
      resolve(contractRoot, "templates"),
      [repository, root],
      "unsafe_contract_entry",
    );
    const directories = [repository, root, schemas, templates];
    const fileIdentities: FileIdentity[] = [];
    const hash = createHash("sha256");
    let totalBytes = 0;
    for (const relativePath of [...CONTRACT_FILES].sort((left, right) =>
      Buffer.from(left, "ascii").compare(Buffer.from(right, "ascii")),
    )) {
      const ancestors: DirectoryIdentity[] = relativePath.startsWith("schemas/")
        ? [repository, root, schemas]
        : relativePath.startsWith("templates/")
          ? [repository, root, templates]
          : [repository, root];
      const path = Buffer.from(relativePath, "ascii");
      const content = readVerifiedFile(
        resolve(contractRoot, relativePath),
        ancestors,
        fileIdentities,
        "unsafe_contract_entry",
        MAX_CONTRACT_FILE_BYTES,
        "unsafe_contract_entry",
      );
      totalBytes += content.length;
      if (totalBytes > MAX_CONTRACT_BUNDLE_BYTES) {
        throw new Error("unsafe_contract_entry");
      }
      hash.update(length(path.length));
      hash.update(path);
      hash.update(length(content.length));
      hash.update(content);
    }

    verifyDirectories(directories, "unsafe_contract_entry");
    verifyFiles(fileIdentities, "unsafe_contract_entry");
    return `sha256:${hash.digest("hex")}`;
  } catch {
    throw new Error("unsafe_contract_entry");
  }
}
