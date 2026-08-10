import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import {
  captureDirectory,
  readVerifiedFile,
  verifyDirectories,
  verifyFiles,
  type DirectoryIdentity,
  type FileIdentity,
} from "./verified-read.js";

interface ContractFile {
  content: Buffer;
  path: Buffer;
}

function portableName(name: Buffer): string {
  if (
    name.length === 0 ||
    !name.every(
      (byte) =>
        (byte >= 0x30 && byte <= 0x39) ||
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x61 && byte <= 0x7a) ||
        byte === 0x2d ||
        byte === 0x2e ||
        byte === 0x5f,
    )
  ) {
    throw new Error("unsafe_contract_entry");
  }
  const value = name.toString("ascii");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error("unsafe_contract_entry");
  }
  return value;
}

function contractFiles(
  root: string,
  current: string,
  ancestors: DirectoryIdentity[],
  allDirectories: DirectoryIdentity[],
  allFiles: FileIdentity[],
): ContractFile[] {
  try {
    const directory = captureDirectory(
      current,
      ancestors,
      "unsafe_contract_entry",
    );
    allDirectories.push(directory);
    const directories = [...ancestors, directory];
    const files = readdirSync(current, {
      encoding: "buffer",
      withFileTypes: true,
    }).flatMap((entry) => {
      const name = portableName(entry.name);
      const absolute = resolve(current, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error("unsafe_contract_entry");
      if (stat.isDirectory())
        return contractFiles(
          root,
          absolute,
          directories,
          allDirectories,
          allFiles,
        );
      if (!stat.isFile()) throw new Error("unsafe_contract_entry");
      return [
        {
          content: readVerifiedFile(
            absolute,
            directories,
            allFiles,
            "unsafe_contract_entry",
          ),
          path: Buffer.from(
            relative(root, absolute).split(sep).join("/"),
            "utf8",
          ),
        },
      ];
    });
    verifyDirectories(directories, "unsafe_contract_entry");
    return files;
  } catch {
    throw new Error("unsafe_contract_entry");
  }
}

function length(value: number): Buffer {
  const framed = Buffer.alloc(8);
  framed.writeBigUInt64BE(BigInt(value));
  return framed;
}

export function computeContractDigest(
  repositoryRoot: string,
): `sha256:${string}` {
  const contractRoot = resolve(repositoryRoot, "contract");
  const directories: DirectoryIdentity[] = [];
  const fileIdentities: FileIdentity[] = [];
  const files = contractFiles(
    contractRoot,
    contractRoot,
    [],
    directories,
    fileIdentities,
  ).sort((left, right) => left.path.compare(right.path));
  verifyDirectories(directories, "unsafe_contract_entry");
  verifyFiles(fileIdentities, "unsafe_contract_entry");
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(length(file.path.length));
    hash.update(file.path);
    hash.update(length(file.content.length));
    hash.update(file.content);
  }
  return `sha256:${hash.digest("hex")}`;
}
