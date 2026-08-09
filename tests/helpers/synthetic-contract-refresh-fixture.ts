import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import type { ContentLicensePolicy } from "../../src/contract/types.js";

import type { FakeReviewRecord } from "./fake-github-review-boundary.js";

export type SemanticDimension =
  | "scope"
  | "spdx_identifier"
  | "official_license_url"
  | "normalized_attribution"
  | "status"
  | "attribution_required"
  | "change_indication_required"
  | "product_provenance_required";

export interface SyntheticBundle {
  root: string;
  repository: string;
  commit: string;
  digest: `sha256:${string}`;
}

export interface SyntheticRefreshFixture {
  root: string;
  owner: string;
  declarationBytes: string | Buffer;
  oldBundle: SyntheticBundle;
  newBundle: SyntheticBundle;
  forkRoot: string;
  beforeCommit: string;
  candidateHead: string;
  changedPaths: string[];
  reviews: FakeReviewRecord[];
}

export interface SyntheticRefreshOptions {
  declarationBytes?: string | Buffer;
  oldDimension?: SemanticDimension;
  aliasNewBundleToOld?: boolean;
  newDeclaredRepository?: string;
  newContractGitlink?: boolean;
  mutateOldBundle?: (root: string) => void;
  mutateNewBundle?: (root: string) => void;
}

const repositoryRoot = resolve(import.meta.dirname, "../..");
const attribution = "Café Fixture Owner";

export const declarationBytes = `---
scope: roastery/beans/**
license: CC-BY-4.0
attribution: "Café Fixture Owner"
---

# Bean Content License

The files under \`roastery/beans/**\` are licensed under \`CC-BY-4.0\`.

Attribution: Café Fixture Owner

Official license: https://creativecommons.org/licenses/by/4.0/

Origin URLs and the resources they identify are excluded from this Bean content
license.

The publisher can license only rights they own or control.
`;

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digest(bytes: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function listFiles(root: string, directory = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...listFiles(root, path));
    else paths.push(relative(root, path).split("/").join("/"));
  }
  return paths;
}

function independentBundleDigest(root: string): `sha256:${string}` {
  const contractRoot = join(root, "contract");
  const paths = listFiles(contractRoot).sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
  const hash = createHash("sha256");
  const count = Buffer.alloc(4);
  count.writeUInt32BE(paths.length);
  hash.update(count);
  for (const path of paths) {
    const pathBytes = Buffer.from(path);
    const content = readFileSync(join(contractRoot, path));
    const pathLength = Buffer.alloc(4);
    pathLength.writeUInt32BE(pathBytes.length);
    const contentLength = Buffer.alloc(8);
    contentLength.writeBigUInt64BE(BigInt(content.length));
    hash.update(pathLength);
    hash.update(pathBytes);
    hash.update(contentLength);
    hash.update(content);
  }
  return `sha256:${hash.digest("hex")}`;
}

function git(root: string, arguments_: string[]): string {
  return execFileSync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-08-09T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-08-09T00:00:00Z",
    },
  }).trim();
}

function initializeGit(root: string): void {
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", root]);
  git(root, ["config", "user.name", "Synthetic Fixture"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
}

function commitAll(root: string, message: string): string {
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function basePolicy(): ContentLicensePolicy {
  const contract = JSON.parse(
    readFileSync(resolve(repositoryRoot, "contract/contract.json"), "utf8"),
  );
  return contract.content_license as ContentLicensePolicy;
}

function mutatePolicy(
  policy: ContentLicensePolicy,
  dimension?: SemanticDimension,
): ContentLicensePolicy {
  const mutated = { ...policy };
  switch (dimension) {
    case "scope":
      mutated.scope = "roastery/other/**";
      break;
    case "spdx_identifier":
      mutated.spdx_identifier = "CC0-1.0";
      break;
    case "official_license_url":
      mutated.official_license_url =
        "https://creativecommons.org/licenses/by/3.0/";
      break;
    case "normalized_attribution":
      mutated.attribution_normalization = "NFD";
      break;
    case "status":
      mutated.supported = false;
      break;
    case "attribution_required":
      mutated.attribution_required = false;
      break;
    case "change_indication_required":
      mutated.change_indication_required = false;
      break;
    case "product_provenance_required":
      mutated.product_provenance_required = false;
      break;
  }
  return mutated;
}

function projectionBytes(policy: ContentLicensePolicy): string {
  return canonicalJson({
    scope: policy.scope,
    spdx_identifier: policy.spdx_identifier,
    official_license_url: policy.official_license_url,
    normalized_attribution: attribution.normalize(
      policy.attribution_normalization,
    ),
    status: policy.supported ? "supported" : "invalid",
    attribution_required: policy.attribution_required,
    change_indication_required: policy.change_indication_required,
    product_provenance_required: policy.product_provenance_required,
  });
}

function createBundle(
  parent: string,
  name: string,
  policy: ContentLicensePolicy,
  mutate?: (root: string) => void,
  contractGitlink = false,
): SyntheticBundle {
  const repository = `https://github.com/synthetic-fixture/${name}`;
  const root = join(parent, name);
  mkdirSync(root, { recursive: true });
  cpSync(resolve(repositoryRoot, "contract"), join(root, "contract"), {
    recursive: true,
  });
  const contractPath = join(root, "contract", "contract.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.content_license = policy;
  writeFileSync(contractPath, canonicalJson(contract));
  mutate?.(root);
  const bundleDigest = independentBundleDigest(root);
  if (contractGitlink) {
    initializeGit(join(root, "contract"));
    commitAll(join(root, "contract"), `synthetic ${name} contract gitlink`);
  }
  initializeGit(root);
  git(root, ["remote", "add", "origin", repository]);
  const commit = commitAll(root, `synthetic ${name}`);
  if (contractGitlink) {
    rmSync(join(root, "contract", ".git"), { force: true, recursive: true });
    git(root, ["config", "diff.ignoreSubmodules", "all"]);
  }
  return {
    root,
    repository,
    commit,
    digest: bundleDigest,
  };
}

function contractPin(bundle: SyntheticBundle, policy: ContentLicensePolicy) {
  const rightsBytes = projectionBytes(policy);
  return {
    repository: bundle.repository,
    commit: bundle.commit,
    digest: bundle.digest,
    rights_semantics_bytes: rightsBytes,
    rights_semantics_digest: digest(rightsBytes),
  };
}

export function createSyntheticContractRefreshFixture(
  dimension?: SemanticDimension,
  options: SyntheticRefreshOptions = {},
): SyntheticRefreshFixture {
  const root = mkdtempSync(join(tmpdir(), "roastery-contract-refresh-"));
  const oldPolicy = mutatePolicy(basePolicy(), options.oldDimension);
  const newPolicy = mutatePolicy(basePolicy(), dimension);
  const oldBundle = createBundle(
    root,
    "contract-a",
    oldPolicy,
    options.mutateOldBundle,
  );
  const createdNewBundle = options.aliasNewBundleToOld
    ? {
        ...oldBundle,
        repository: "https://github.com/synthetic-fixture/contract-b",
      }
    : createBundle(
        root,
        "contract-b",
        newPolicy,
        options.mutateNewBundle,
        options.newContractGitlink,
      );
  const newBundle = options.newDeclaredRepository
    ? { ...createdNewBundle, repository: options.newDeclaredRepository }
    : createdNewBundle;

  const forkRoot = join(root, "fork");
  mkdirSync(join(forkRoot, ".coffee-chat"), { recursive: true });
  mkdirSync(join(forkRoot, "roastery", "beans"), { recursive: true });
  writeFileSync(
    join(forkRoot, "fixture-manifest.json"),
    canonicalJson({
      owner: "fixture-owner",
      repository: "https://github.com/fixture-owner/fixture-roastery",
    }),
  );
  const selectedDeclarationBytes = options.declarationBytes ?? declarationBytes;
  writeFileSync(
    join(forkRoot, "roastery", "CONTENT_LICENSE.md"),
    selectedDeclarationBytes,
  );
  writeFileSync(
    join(forkRoot, "roastery", "index.json"),
    canonicalJson({ beans: [] }),
  );
  writeFileSync(
    join(forkRoot, ".coffee-chat", "contract-pin.json"),
    canonicalJson(contractPin(oldBundle, oldPolicy)),
  );
  initializeGit(forkRoot);
  const beforeCommit = commitAll(forkRoot, "pin contract A");
  writeFileSync(
    join(forkRoot, ".coffee-chat", "contract-pin.json"),
    canonicalJson(contractPin(newBundle, newPolicy)),
  );
  const candidateHead = commitAll(forkRoot, "refresh to contract B");

  return {
    root,
    owner: "fixture-owner",
    declarationBytes: selectedDeclarationBytes,
    oldBundle,
    newBundle,
    forkRoot,
    beforeCommit,
    candidateHead,
    changedPaths: [".coffee-chat/contract-pin.json"],
    reviews: [
      { reviewer: "fixture-owner", headSha: candidateHead, state: "approved" },
    ],
  };
}

export function sha256(bytes: string | Buffer): `sha256:${string}` {
  return digest(bytes);
}
