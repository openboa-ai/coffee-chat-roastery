import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { digestContractBundle } from "../contract/digest.ts";
import {
  CONTRACT_REPOSITORY,
  type ContractPin,
  type RoasteryManifest,
} from "../contract/types.ts";
import { validateContractBundle } from "./contract-bundle.ts";
import { parseContentLicense } from "./content-license.ts";
import { requireNoFollowPath } from "./filesystem.ts";
import { validateCommittedIndex } from "./index.ts";
import { validateRoasteryManifest } from "./roastery.ts";

export type RepositoryValidationResult =
  | {
      status: "valid";
      repository: string;
      bean_count: number;
      contract: ContractPin;
    }
  | { status: "invalid"; reason: string };

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const COMMIT = /^[0-9a-f]{40}$/u;
const ALLOWED_ROASTERY_FILES = new Set([
  "roastery.json",
  "index.json",
  "CONTENT_LICENSE.md",
]);

async function validateSafeRoasteryTree(root: string): Promise<string | null> {
  const normalizedRoot = resolve(root);
  let rootMetadata;
  try {
    rootMetadata = await lstat(normalizedRoot);
  } catch {
    return "missing_repository";
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    return "unsafe_repository_path";
  }

  const roasteryRoot = join(normalizedRoot, "roastery");
  let entries;
  try {
    const roasteryState = await requireNoFollowPath(
      normalizedRoot,
      "roastery",
      "directory",
      true,
    );
    if (roasteryState === "missing") return "missing_roastery";
    entries = await readdir(roasteryRoot, { withFileTypes: true });
  } catch {
    return "unsafe_repository_path";
  }

  try {
    for (const entry of entries) {
      const path = join(roasteryRoot, entry.name);
      const metadata = await lstat(path);
      if (
        metadata.isSymbolicLink() ||
        (!metadata.isFile() && !metadata.isDirectory())
      ) {
        return "unsafe_repository_path";
      }
      if (entry.name === "beans") {
        if (!metadata.isDirectory()) return "unsafe_repository_path";
        const beanEntries = await readdir(path, { withFileTypes: true });
        for (const beanEntry of beanEntries) {
          const beanMetadata = await lstat(join(path, beanEntry.name));
          if (
            beanMetadata.isSymbolicLink() ||
            !beanMetadata.isFile() ||
            !beanEntry.name.endsWith(".md")
          ) {
            return "unsafe_repository_path";
          }
        }
        continue;
      }
      if (!metadata.isFile() || !ALLOWED_ROASTERY_FILES.has(entry.name)) {
        return "unexpected_roastery_path";
      }
    }
  } catch {
    return "unsafe_repository_path";
  }
  return null;
}

function packageCommit(packageRoot: string): string {
  try {
    const packageDocument = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8"),
    ) as { gitHead?: unknown };
    if (
      typeof packageDocument.gitHead === "string" &&
      COMMIT.test(packageDocument.gitHead)
    ) {
      return packageDocument.gitHead;
    }
  } catch {
    // A source checkout can still provide immutable Git provenance below.
  }
  try {
    const commit = execFileSync(
      "git",
      ["-C", packageRoot, "rev-parse", "HEAD"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (COMMIT.test(commit)) return commit;
  } catch {
    // Converted to an explicit validation result by the caller.
  }
  throw new Error("trusted_contract_unavailable");
}

async function readManifest(root: string): Promise<unknown> {
  return JSON.parse(
    await readFile(join(root, "roastery", "roastery.json"), "utf8"),
  );
}

export async function validateRepository(
  root: string,
  expectedContract?: ContractPin,
  trustedBundleRoot = PACKAGE_ROOT,
): Promise<RepositoryValidationResult> {
  const unsafeReason = await validateSafeRoasteryTree(root);
  if (unsafeReason !== null) return { status: "invalid", reason: unsafeReason };

  let trustedBundle;
  try {
    trustedBundle = await validateContractBundle(trustedBundleRoot);
  } catch {
    return { status: "invalid", reason: "invalid_contract_bundle" };
  }
  let trustedContract: ContractPin;
  try {
    trustedContract =
      expectedContract ??
      ({
        repository: CONTRACT_REPOSITORY,
        commit: packageCommit(trustedBundleRoot),
        digest: trustedBundle.digest,
      } satisfies ContractPin);
  } catch {
    return { status: "invalid", reason: "trusted_contract_unavailable" };
  }
  if (
    trustedContract.repository !== CONTRACT_REPOSITORY ||
    trustedContract.digest !== trustedBundle.digest ||
    !COMMIT.test(trustedContract.commit)
  ) {
    return { status: "invalid", reason: "contract_mismatch" };
  }

  let selectedDigest;
  try {
    selectedDigest = await digestContractBundle(root);
  } catch {
    return { status: "invalid", reason: "invalid_contract_bundle" };
  }
  if (selectedDigest !== trustedBundle.digest) {
    return { status: "invalid", reason: "contract_mismatch" };
  }
  try {
    await validateContractBundle(root);
  } catch {
    return { status: "invalid", reason: "invalid_contract_bundle" };
  }

  let manifestValue: unknown;
  try {
    manifestValue = await readManifest(root);
  } catch {
    return { status: "invalid", reason: "invalid_roastery_manifest" };
  }
  if (!trustedBundle.schemas.roastery(manifestValue)) {
    return { status: "invalid", reason: "invalid_roastery_manifest" };
  }
  const manifestResult = validateRoasteryManifest(
    manifestValue,
    trustedContract,
  );
  if (manifestResult.status === "invalid") return manifestResult;
  const manifest: RoasteryManifest = manifestResult.manifest;

  let licenseSource: Buffer | undefined;
  try {
    licenseSource = await readFile(
      join(root, "roastery", "CONTENT_LICENSE.md"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { status: "invalid", reason: "invalid_content_license" };
    }
  }

  if (licenseSource !== undefined) {
    const license = parseContentLicense(
      licenseSource,
      trustedBundle.schemas.contentLicense,
    );
    if (license.status !== "supported") {
      return { status: "invalid", reason: license.status };
    }
  }

  const indexResult = await validateCommittedIndex(
    root,
    trustedBundle.schemas.index,
    trustedBundle.schemas.beanFrontmatter,
  );
  if (indexResult.status === "invalid") return indexResult;
  if (licenseSource === undefined && indexResult.index.beans.length > 0) {
    return { status: "invalid", reason: "invalid_content_license" };
  }

  return {
    status: "valid",
    repository: manifest.repository,
    bean_count: indexResult.index.beans.length,
    contract: manifest.contract,
  };
}
