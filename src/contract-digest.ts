import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

interface ContractFile {
  content: Buffer;
  path: Buffer;
}

function contractFiles(root: string, current: string): ContractFile[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(current, entry.name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("unsafe_contract_entry");
    if (stat.isDirectory()) return contractFiles(root, absolute);
    if (!stat.isFile()) throw new Error("unsafe_contract_entry");
    return [
      {
        content: readFileSync(absolute),
        path: Buffer.from(
          relative(root, absolute).split(sep).join("/"),
          "utf8",
        ),
      },
    ];
  });
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
  if (lstatSync(contractRoot).isSymbolicLink()) {
    throw new Error("unsafe_contract_entry");
  }
  const files = contractFiles(contractRoot, contractRoot).sort((left, right) =>
    left.path.compare(right.path),
  );
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(length(file.path.length));
    hash.update(file.path);
    hash.update(length(file.content.length));
    hash.update(file.content);
  }
  return `sha256:${hash.digest("hex")}`;
}
