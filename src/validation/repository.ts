import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { digestContractBundle } from "../contract/digest.ts";
import type { ContractPin, RoasteryManifest } from "../contract/types.ts";
import { projectIndex } from "../projection/index.ts";
import type { RightsSemanticsProjection } from "../projection/rights-semantics.ts";
import {
  interpretContractBundle,
  isFixedInitialContentLicensePolicy,
  type InterpretedContractBundle,
} from "./contract-bundle.ts";
import { parseContentLicense } from "./content-license.ts";
import { requireNoFollowPath } from "./filesystem.ts";
import { validateCommittedIndex } from "./index.ts";
import { validateRoasteryManifest } from "./roastery.ts";

export const OWNER_PUBLICATION_ATTESTATION =
  "I attest that this Bean contains no embedded third-party material requiring attribution or prior-modification notices beyond the current Standard Roastery declaration and citation contract; Origin URLs and the resources they identify are references outside this Bean license." as const;

const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BEAN_PATH =
  /^roastery\/beans\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/u;
const GITHUB_REPOSITORY =
  /^https:\/\/github\.com\/[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9][a-z0-9._-]*$/u;

export interface ReviewRecord {
  reviewer: string;
  headSha: string;
  state: "approved" | "changes_requested" | "commented";
}

export interface BeanPublicationInput {
  headSha: string;
  changedPaths: string[];
  beanPath: string;
  attestedBeanPath: string;
  beanDigest: string;
  attestedBeanDigest: string;
  changeSetDigest: string;
  attestedChangeSetDigest: string;
  attestedHeadSha: string;
  attestation: string;
  accepted: boolean;
  embeddedThirdPartyNoticesRequired: boolean;
}

export interface AttributionCorrectionInput {
  owner: string;
  headSha: string;
  changedPaths: string[];
  reviews: ReviewRecord[];
  beforeBytes: string | Uint8Array;
  afterBytes: string | Uint8Array;
  priorGrantReceiptDigestsBefore: string[];
  priorGrantReceiptDigestsAfter: string[];
}

export interface RefreshBundleInput {
  root: string;
  repository: string;
  commit: string;
  digest: `sha256:${string}`;
}

export interface ContractRefreshInput {
  fixtureOwner: string;
  forkRoot: string;
  beforeCommit: string;
  candidateHead: string;
  changedPaths: string[];
  reviews: ReviewRecord[];
  oldBundle: RefreshBundleInput;
  newBundle: RefreshBundleInput;
  pinPath: string;
}

interface RefreshPin {
  repository: string;
  commit: string;
  digest: string;
  rights_semantics_bytes: string;
  rights_semantics_digest: string;
}

interface ValidatedBundle
  extends RefreshBundleInput, InterpretedContractBundle {}

export interface AcceptedContractRefresh {
  status: "accepted";
  fixture_owner: string;
  old_bundle: RefreshBundleInput;
  new_bundle: RefreshBundleInput;
  before_tree_digest: `sha256:${string}`;
  after_tree_digest: `sha256:${string}`;
  before_roastery_digest: `sha256:${string}`;
  after_roastery_digest: `sha256:${string}`;
  roastery_bytes_equal: true;
  declaration_bytes: string;
  declaration_digest: `sha256:${string}`;
  old_projection_bytes: string;
  old_projection_digest: `sha256:${string}`;
  new_projection_bytes: string;
  new_projection_digest: `sha256:${string}`;
  projection_bytes_equal: true;
  projection_digests_equal: true;
  changed_paths: string[];
  repinning_result: "passed";
  bundle_validation: { a: "passed"; b: "passed" };
}

export type ContractRefreshResult =
  | AcceptedContractRefresh
  | {
      status: "rejected";
      reason: string;
      dimensions?: string[];
    };

type Rejected = { status: "rejected"; reason: string };

export type RepositoryValidationResult =
  | {
      status: "valid";
      repository: string;
      bean_count: number;
      contract: ContractPin;
    }
  | { status: "invalid"; reason: string };

const ALLOWED_ROASTERY_FILES = new Set([
  "roastery.json",
  "index.json",
  "CONTENT_LICENSE.md",
]);

async function validateSafeRoasteryTree(root: string): Promise<string | null> {
  let rootMetadata;
  try {
    rootMetadata = await lstat(root);
  } catch {
    return "missing_repository";
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    return "unsafe_repository_path";
  }

  const roasteryRoot = join(root, "roastery");
  let entries;
  try {
    const roasteryPath = await requireNoFollowPath(
      root,
      "roastery",
      "directory",
      true,
    );
    if (roasteryPath === "missing") return "missing_roastery";
    entries = await readdir(roasteryRoot, { withFileTypes: true });
  } catch {
    return "unsafe_repository_path";
  }

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
      try {
        await requireNoFollowPath(root, "roastery/beans", "directory");
      } catch {
        return "unsafe_repository_path";
      }
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
  return null;
}

async function readManifest(root: string): Promise<unknown> {
  return JSON.parse(
    await readFile(join(root, "roastery", "roastery.json"), "utf8"),
  );
}

export async function validateRepository(
  root: string,
  expectedContract: ContractPin,
): Promise<RepositoryValidationResult> {
  const unsafeReason = await validateSafeRoasteryTree(root);
  if (unsafeReason !== null) return { status: "invalid", reason: unsafeReason };

  let manifestValue: unknown;
  try {
    manifestValue = await readManifest(root);
  } catch {
    return { status: "invalid", reason: "invalid_roastery_manifest" };
  }
  const manifestResult = validateRoasteryManifest(
    manifestValue,
    expectedContract,
  );
  if (manifestResult.status === "invalid") {
    return manifestResult;
  }
  const manifest: RoasteryManifest = manifestResult.manifest;

  let bundleDigest: string;
  try {
    bundleDigest = await digestContractBundle(root);
  } catch {
    return { status: "invalid", reason: "invalid_contract_bundle" };
  }
  if (bundleDigest !== manifest.contract.digest) {
    return { status: "invalid", reason: "contract_mismatch" };
  }

  const indexResult = await validateCommittedIndex(root);
  if (indexResult.status === "invalid") return indexResult;
  const index = await projectIndex(root);

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
  if (licenseSource === undefined && index.beans.length > 0) {
    return { status: "invalid", reason: "invalid_content_license" };
  }
  if (licenseSource !== undefined) {
    const license = parseContentLicense(licenseSource);
    if (license.status !== "supported") {
      return { status: "invalid", reason: license.status };
    }
    try {
      const interpreted = await interpretContractBundle(root, licenseSource);
      if (!isFixedInitialContentLicensePolicy(interpreted.policy)) {
        return { status: "invalid", reason: "invalid_contract_bundle" };
      }
    } catch {
      return { status: "invalid", reason: "invalid_contract_bundle" };
    }
  }

  return {
    status: "valid",
    repository: manifest.repository,
    bean_count: index.beans.length,
    contract: manifest.contract,
  };
}

function exactOwnerHeadApproval(
  owner: string,
  headSha: string,
  reviews: ReviewRecord[],
): boolean {
  const matching = reviews.filter(
    (review) => review.reviewer === owner && review.headSha === headSha,
  );
  return (
    matching.some((review) => review.state === "approved") &&
    !matching.some((review) => review.state === "changes_requested")
  );
}

function sha256(bytes: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const SAFE_REPOSITORY_GIT_ARGUMENTS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.pager=cat",
  "-c",
  "pager.status=false",
  "-c",
  "diff.external=",
] as const;

const SAFE_REPOSITORY_GIT_ENVIRONMENT = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
};

function gitText(root: string, arguments_: string[]): string {
  return execFileSync(
    "git",
    [...SAFE_REPOSITORY_GIT_ARGUMENTS, "-C", root, ...arguments_],
    {
      env: SAFE_REPOSITORY_GIT_ENVIRONMENT,
      encoding: "utf8",
    },
  ).trim();
}

function gitBytes(root: string, arguments_: string[]): Buffer {
  return execFileSync(
    "git",
    [...SAFE_REPOSITORY_GIT_ARGUMENTS, "-C", root, ...arguments_],
    {
      env: SAFE_REPOSITORY_GIT_ENVIRONMENT,
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function normalizedGitHubRemote(remote: string): string | null {
  let repositoryPath: string;
  if (remote.startsWith("https://github.com/")) {
    repositoryPath = remote.slice("https://github.com/".length);
  } else if (remote.startsWith("git@github.com:")) {
    repositoryPath = remote.slice("git@github.com:".length);
  } else {
    return null;
  }
  if (repositoryPath.endsWith(".git")) {
    repositoryPath = repositoryPath.slice(0, -4);
  }
  const normalized = `https://github.com/${repositoryPath}`;
  return GITHUB_REPOSITORY.test(normalized) ? normalized : null;
}

async function materializeCommittedContractBundle(
  repositoryRoot: string,
  commit: string,
): Promise<string> {
  const contractEntry = gitText(repositoryRoot, [
    "ls-tree",
    commit,
    "--",
    "contract",
  ]);
  if (!/^040000 tree [0-9a-f]{40}\tcontract$/u.test(contractEntry)) {
    throw new Error("contract is not a committed tree");
  }

  const entries = gitBytes(repositoryRoot, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    commit,
    "--",
    "contract",
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error("committed contract tree is empty");
  }

  const materializedRoot = await mkdtemp(
    join(tmpdir(), "roastery-committed-contract-"),
  );
  try {
    for (const entry of entries) {
      const match =
        /^(100644) blob ([0-9a-f]{40})\t(contract\/[A-Za-z0-9._/-]+)$/u.exec(
          entry,
        );
      if (match === null) {
        throw new Error("committed contract contains a non-data entry");
      }
      const objectId = match[2] as string;
      const path = match[3] as string;
      if (
        path
          .slice("contract/".length)
          .split("/")
          .some(
            (segment) => segment === "" || segment === "." || segment === "..",
          )
      ) {
        throw new Error("committed contract path is unsafe");
      }
      const target = join(materializedRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(
        target,
        gitBytes(repositoryRoot, ["cat-file", "blob", objectId]),
        { mode: 0o600 },
      );
    }
    return materializedRoot;
  } catch (error) {
    await rm(materializedRoot, { force: true, recursive: true });
    throw error;
  }
}

async function validateRefreshBundle(
  bundle: RefreshBundleInput,
  declarationBytes: Uint8Array,
): Promise<ValidatedBundle | { status: "rejected"; reason: string }> {
  let head: string;
  try {
    head = gitText(bundle.root, ["rev-parse", "HEAD"]);
  } catch {
    return { status: "rejected", reason: "bundle_commit_mismatch" };
  }
  if (!COMMIT.test(bundle.commit) || head !== bundle.commit) {
    return { status: "rejected", reason: "bundle_commit_mismatch" };
  }
  let acquiredRepository: string | null;
  try {
    acquiredRepository = normalizedGitHubRemote(
      gitText(bundle.root, ["remote", "get-url", "origin"]),
    );
  } catch {
    return { status: "rejected", reason: "bundle_repository_mismatch" };
  }
  if (
    !GITHUB_REPOSITORY.test(bundle.repository) ||
    acquiredRepository !== bundle.repository
  ) {
    return { status: "rejected", reason: "bundle_repository_mismatch" };
  }
  let committedRoot: string;
  try {
    committedRoot = await materializeCommittedContractBundle(
      bundle.root,
      bundle.commit,
    );
  } catch {
    return { status: "rejected", reason: "bundle_byte_mismatch" };
  }
  try {
    const actualDigest = await digestContractBundle(committedRoot);
    if (!DIGEST.test(bundle.digest) || actualDigest !== bundle.digest) {
      return { status: "rejected", reason: "bundle_digest_mismatch" };
    }
    return {
      ...bundle,
      ...(await interpretContractBundle(committedRoot, declarationBytes)),
    };
  } catch {
    return { status: "rejected", reason: "bundle_validation_failed" };
  } finally {
    await rm(committedRoot, { force: true, recursive: true });
  }
}

function parseRefreshPin(source: string): RefreshPin | null {
  try {
    const value: unknown = JSON.parse(source);
    if (
      !isRecord(value) ||
      !sameKeys(value, [
        "repository",
        "commit",
        "digest",
        "rights_semantics_bytes",
        "rights_semantics_digest",
      ]) ||
      typeof value.repository !== "string" ||
      typeof value.commit !== "string" ||
      typeof value.digest !== "string" ||
      typeof value.rights_semantics_bytes !== "string" ||
      typeof value.rights_semantics_digest !== "string"
    ) {
      return null;
    }
    return value as unknown as RefreshPin;
  } catch {
    return null;
  }
}

function projectionDifferences(
  oldProjection: RightsSemanticsProjection,
  newProjection: RightsSemanticsProjection,
): string[] {
  const fields: Array<keyof RightsSemanticsProjection> = [
    "scope",
    "spdx_identifier",
    "official_license_url",
    "normalized_attribution",
    "status",
    "attribution_required",
    "change_indication_required",
    "product_provenance_required",
  ];
  return fields.filter(
    (field) => oldProjection[field] !== newProjection[field],
  );
}

function pinMatches(
  pin: RefreshPin | null,
  bundle: ValidatedBundle,
  projectionBytes: string,
  projectionDigest: string,
): boolean {
  return (
    pin !== null &&
    pin.repository === bundle.repository &&
    pin.commit === bundle.commit &&
    pin.digest === bundle.digest &&
    pin.rights_semantics_bytes === projectionBytes &&
    pin.rights_semantics_digest === projectionDigest
  );
}

export async function evaluateContractRefreshCandidate(
  input: ContractRefreshInput,
): Promise<ContractRefreshResult> {
  if (!COMMIT.test(input.beforeCommit) || !COMMIT.test(input.candidateHead)) {
    return { status: "rejected", reason: "commit_reference_invalid" };
  }
  let actualHead: string;
  try {
    actualHead = gitText(input.forkRoot, ["rev-parse", "HEAD"]);
  } catch {
    return { status: "rejected", reason: "candidate_head_mismatch" };
  }
  if (actualHead !== input.candidateHead) {
    return { status: "rejected", reason: "candidate_head_mismatch" };
  }

  let fixtureManifest: unknown;
  try {
    fixtureManifest = JSON.parse(
      gitText(input.forkRoot, [
        "show",
        `${input.candidateHead}:fixture-manifest.json`,
      ]),
    );
  } catch {
    return { status: "rejected", reason: "fixture_owner_mismatch" };
  }
  if (
    !isRecord(fixtureManifest) ||
    fixtureManifest.owner !== input.fixtureOwner
  ) {
    return { status: "rejected", reason: "fixture_owner_mismatch" };
  }

  const actualChangedPaths = gitText(input.forkRoot, [
    "diff",
    "--name-only",
    input.beforeCommit,
    input.candidateHead,
  ])
    .split("\n")
    .filter(Boolean)
    .sort();
  if (
    JSON.stringify(actualChangedPaths) !==
      JSON.stringify([...input.changedPaths].sort()) ||
    JSON.stringify(actualChangedPaths) !== JSON.stringify([input.pinPath])
  ) {
    return { status: "rejected", reason: "changed_paths_mismatch" };
  }
  if (
    !exactOwnerHeadApproval(
      input.fixtureOwner,
      input.candidateHead,
      input.reviews,
    )
  ) {
    return { status: "rejected", reason: "owner_review_required" };
  }

  let beforeDeclaration: Buffer;
  let afterDeclaration: Buffer;
  let beforePin: RefreshPin | null;
  let afterPin: RefreshPin | null;
  try {
    beforeDeclaration = gitBytes(input.forkRoot, [
      "show",
      `${input.beforeCommit}:roastery/CONTENT_LICENSE.md`,
    ]);
    afterDeclaration = gitBytes(input.forkRoot, [
      "show",
      `${input.candidateHead}:roastery/CONTENT_LICENSE.md`,
    ]);
    beforePin = parseRefreshPin(
      gitText(input.forkRoot, [
        "show",
        `${input.beforeCommit}:${input.pinPath}`,
      ]),
    );
    afterPin = parseRefreshPin(
      gitText(input.forkRoot, [
        "show",
        `${input.candidateHead}:${input.pinPath}`,
      ]),
    );
  } catch {
    return { status: "rejected", reason: "refresh_evidence_missing" };
  }
  if (!beforeDeclaration.equals(afterDeclaration)) {
    return { status: "rejected", reason: "declaration_bytes_changed" };
  }
  if (
    parseContentLicense(beforeDeclaration).status !== "supported" ||
    parseContentLicense(afterDeclaration).status !== "supported"
  ) {
    return { status: "rejected", reason: "invalid_declaration" };
  }

  let oldBundleRoot: string;
  let newBundleRoot: string;
  try {
    [oldBundleRoot, newBundleRoot] = await Promise.all([
      realpath(input.oldBundle.root),
      realpath(input.newBundle.root),
    ]);
  } catch {
    return { status: "rejected", reason: "bundle_independence_required" };
  }
  if (oldBundleRoot === newBundleRoot) {
    return { status: "rejected", reason: "bundle_independence_required" };
  }

  const oldBundle = await validateRefreshBundle(
    input.oldBundle,
    beforeDeclaration,
  );
  if ("status" in oldBundle) {
    return oldBundle.reason === "bundle_validation_failed"
      ? { status: "rejected", reason: "old_bundle_validation_failed" }
      : oldBundle;
  }
  if (!isFixedInitialContentLicensePolicy(oldBundle.policy)) {
    return { status: "rejected", reason: "old_bundle_policy_invalid" };
  }
  const newBundle = await validateRefreshBundle(
    input.newBundle,
    afterDeclaration,
  );
  if ("status" in newBundle) {
    return newBundle.reason === "bundle_validation_failed"
      ? { status: "rejected", reason: "new_bundle_validation_failed" }
      : newBundle;
  }

  const oldProjection = oldBundle.projection;
  const newProjection = newBundle.projection;
  const oldProjectionBytes = oldBundle.projectionBytes;
  const newProjectionBytes = newBundle.projectionBytes;
  const oldProjectionDigest = oldBundle.projectionDigest;
  const newProjectionDigest = newBundle.projectionDigest;
  if (
    !pinMatches(
      beforePin,
      oldBundle,
      oldProjectionBytes,
      oldProjectionDigest,
    ) ||
    !pinMatches(afterPin, newBundle, newProjectionBytes, newProjectionDigest)
  ) {
    return { status: "rejected", reason: "projection_pin_mismatch" };
  }

  const dimensions = projectionDifferences(oldProjection, newProjection);
  if (
    oldProjectionBytes !== newProjectionBytes ||
    oldProjectionDigest !== newProjectionDigest
  ) {
    return {
      status: "rejected",
      reason: "rights_semantics_mismatch",
      dimensions,
    };
  }

  const beforeTreeDigest = sha256(
    gitBytes(input.forkRoot, ["ls-tree", "-r", "-z", input.beforeCommit]),
  );
  const afterTreeDigest = sha256(
    gitBytes(input.forkRoot, ["ls-tree", "-r", "-z", input.candidateHead]),
  );
  const beforeRoasteryDigest = sha256(
    gitBytes(input.forkRoot, [
      "ls-tree",
      "-r",
      "-z",
      input.beforeCommit,
      "--",
      "roastery",
    ]),
  );
  const afterRoasteryDigest = sha256(
    gitBytes(input.forkRoot, [
      "ls-tree",
      "-r",
      "-z",
      input.candidateHead,
      "--",
      "roastery",
    ]),
  );
  if (beforeRoasteryDigest !== afterRoasteryDigest) {
    return { status: "rejected", reason: "roastery_bytes_changed" };
  }

  return {
    status: "accepted",
    fixture_owner: input.fixtureOwner,
    old_bundle: input.oldBundle,
    new_bundle: input.newBundle,
    before_tree_digest: beforeTreeDigest,
    after_tree_digest: afterTreeDigest,
    before_roastery_digest: beforeRoasteryDigest,
    after_roastery_digest: afterRoasteryDigest,
    roastery_bytes_equal: true,
    declaration_bytes: beforeDeclaration.toString("utf8"),
    declaration_digest: sha256(beforeDeclaration),
    old_projection_bytes: oldProjectionBytes,
    old_projection_digest: oldProjectionDigest,
    new_projection_bytes: newProjectionBytes,
    new_projection_digest: newProjectionDigest,
    projection_bytes_equal: true,
    projection_digests_equal: true,
    changed_paths: actualChangedPaths,
    repinning_result: "passed",
    bundle_validation: {
      a: oldBundle.validation,
      b: newBundle.validation,
    },
  };
}

const SEMANTIC_DIMENSIONS = [
  "scope",
  "spdx_identifier",
  "official_license_url",
  "normalized_attribution",
  "status",
  "attribution_required",
  "change_indication_required",
  "product_provenance_required",
] as const;

const CONTRACT_REFRESH_EVIDENCE_KEYS = [
  "status",
  "evidence_class",
  "fixture_owner",
  "synthetic_repositories",
  "before_tree_digest",
  "after_tree_digest",
  "before_roastery_digest",
  "after_roastery_digest",
  "declaration_bytes",
  "declaration_digest",
  "old_projection_bytes",
  "old_projection_digest",
  "new_projection_bytes",
  "new_projection_digest",
  "projection_bytes_equal",
  "projection_digests_equal",
  "semantic_dimension_negatives",
  "changed_paths",
  "fake_review_boundary",
  "repinning_result",
  "bundle_validation",
  "protected_canary_receipt",
] as const;

function orderedContractRefreshEvidence(value: unknown) {
  if (!isRecord(value) || !sameKeys(value, CONTRACT_REFRESH_EVIDENCE_KEYS)) {
    throw new Error("canonical evidence is invalid");
  }
  const repositories = value.synthetic_repositories;
  const negatives = value.semantic_dimension_negatives;
  const review = value.fake_review_boundary;
  const validation = value.bundle_validation;
  const canary = value.protected_canary_receipt;
  if (
    !isRecord(repositories) ||
    !sameKeys(repositories, ["a", "b"]) ||
    !isRecord(repositories.a) ||
    !sameKeys(repositories.a, ["repository", "commit", "digest"]) ||
    !isRecord(repositories.b) ||
    !sameKeys(repositories.b, ["repository", "commit", "digest"]) ||
    !isRecord(negatives) ||
    !sameKeys(negatives, SEMANTIC_DIMENSIONS) ||
    !isRecord(review) ||
    !sameKeys(review, [
      "missing",
      "wrong_owner",
      "stale_head",
      "exact_owner_head",
    ]) ||
    !isRecord(validation) ||
    !sameKeys(validation, ["a", "b"]) ||
    !isRecord(canary) ||
    !sameKeys(canary, ["reference", "digest"])
  ) {
    throw new Error("canonical evidence is invalid");
  }
  return {
    status: value.status,
    evidence_class: value.evidence_class,
    fixture_owner: value.fixture_owner,
    synthetic_repositories: {
      a: {
        repository: repositories.a.repository,
        commit: repositories.a.commit,
        digest: repositories.a.digest,
      },
      b: {
        repository: repositories.b.repository,
        commit: repositories.b.commit,
        digest: repositories.b.digest,
      },
    },
    before_tree_digest: value.before_tree_digest,
    after_tree_digest: value.after_tree_digest,
    before_roastery_digest: value.before_roastery_digest,
    after_roastery_digest: value.after_roastery_digest,
    declaration_bytes: value.declaration_bytes,
    declaration_digest: value.declaration_digest,
    old_projection_bytes: value.old_projection_bytes,
    old_projection_digest: value.old_projection_digest,
    new_projection_bytes: value.new_projection_bytes,
    new_projection_digest: value.new_projection_digest,
    projection_bytes_equal: value.projection_bytes_equal,
    projection_digests_equal: value.projection_digests_equal,
    semantic_dimension_negatives: Object.fromEntries(
      SEMANTIC_DIMENSIONS.map((dimension) => [dimension, negatives[dimension]]),
    ),
    changed_paths: value.changed_paths,
    fake_review_boundary: {
      missing: review.missing,
      wrong_owner: review.wrong_owner,
      stale_head: review.stale_head,
      exact_owner_head: review.exact_owner_head,
    },
    repinning_result: value.repinning_result,
    bundle_validation: { a: validation.a, b: validation.b },
    protected_canary_receipt: {
      reference: canary.reference,
      digest: canary.digest,
    },
  };
}

export function serializeContractRefreshEvidence(value: unknown): string {
  return `${JSON.stringify(orderedContractRefreshEvidence(value), null, 2)}\n`;
}

interface ContractRefreshReceiptEnvelopeInput {
  evidenceBytes: string | Uint8Array;
  evidenceArtifact: { id: string; digest: string; url: string };
  runUrl: string;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function buildContractRefreshReceiptEnvelope(
  input: ContractRefreshReceiptEnvelopeInput,
) {
  let source: string;
  let parsed: unknown;
  try {
    source =
      typeof input.evidenceBytes === "string"
        ? input.evidenceBytes
        : new TextDecoder("utf-8", { fatal: true }).decode(input.evidenceBytes);
    parsed = JSON.parse(source);
  } catch {
    throw new Error("canonical evidence is invalid");
  }
  if (serializeContractRefreshEvidence(parsed) !== source) {
    throw new Error("canonical evidence bytes are required");
  }
  if (
    !/^[1-9][0-9]*$/u.test(input.evidenceArtifact.id) ||
    !DIGEST.test(input.evidenceArtifact.digest) ||
    !isHttpsUrl(input.evidenceArtifact.url) ||
    !isHttpsUrl(input.runUrl)
  ) {
    throw new Error("receipt provenance is invalid");
  }
  return {
    status: "passed" as const,
    evidence: {
      path: "artifacts/contract-refresh-evidence.json" as const,
      digest: sha256(source),
    },
    evidence_artifact: {
      id: input.evidenceArtifact.id,
      digest: input.evidenceArtifact.digest,
      url: input.evidenceArtifact.url,
    },
    run_url: input.runUrl,
  };
}

interface ContractRefreshEvidenceInput {
  positive: ContractRefreshResult;
  semanticDimensionNegatives: Record<string, ContractRefreshResult>;
  reviewBoundaryResults: {
    missing: "rejected";
    wrong_owner: "rejected";
    stale_head: "rejected";
    exact_owner_head: "accepted";
  };
  protectedCanaryReceipt: {
    root: string;
    reference: string;
    digest: string;
  };
}

export async function buildContractRefreshEvidence(
  input: ContractRefreshEvidenceInput,
) {
  if (input.positive.status !== "accepted") {
    throw new Error("positive contract refresh evidence is required");
  }
  const semanticDimensionNegatives: Record<string, "rejected"> = {};
  for (const dimension of SEMANTIC_DIMENSIONS) {
    const result = input.semanticDimensionNegatives[dimension];
    if (
      result?.status !== "rejected" ||
      result.reason !== "rights_semantics_mismatch" ||
      JSON.stringify(result.dimensions) !== JSON.stringify([dimension])
    ) {
      throw new Error(`missing negative oracle for ${dimension}`);
    }
    semanticDimensionNegatives[dimension] = "rejected";
  }
  if (!DIGEST.test(input.protectedCanaryReceipt.digest)) {
    throw new Error("receipt provenance is invalid");
  }
  let canaryBytes: Buffer;
  try {
    await requireNoFollowPath(
      input.protectedCanaryReceipt.root,
      input.protectedCanaryReceipt.reference,
      "file",
    );
    canaryBytes = await readFile(
      join(
        input.protectedCanaryReceipt.root,
        input.protectedCanaryReceipt.reference,
      ),
    );
  } catch {
    throw new Error("canary receipt is unavailable");
  }
  if (sha256(canaryBytes) !== input.protectedCanaryReceipt.digest) {
    throw new Error("canary receipt digest mismatch");
  }

  return {
    status: "passed" as const,
    evidence_class: "fixture" as const,
    fixture_owner: input.positive.fixture_owner,
    synthetic_repositories: {
      a: {
        repository: input.positive.old_bundle.repository,
        commit: input.positive.old_bundle.commit,
        digest: input.positive.old_bundle.digest,
      },
      b: {
        repository: input.positive.new_bundle.repository,
        commit: input.positive.new_bundle.commit,
        digest: input.positive.new_bundle.digest,
      },
    },
    before_tree_digest: input.positive.before_tree_digest,
    after_tree_digest: input.positive.after_tree_digest,
    before_roastery_digest: input.positive.before_roastery_digest,
    after_roastery_digest: input.positive.after_roastery_digest,
    declaration_bytes: input.positive.declaration_bytes,
    declaration_digest: input.positive.declaration_digest,
    old_projection_bytes: input.positive.old_projection_bytes,
    old_projection_digest: input.positive.old_projection_digest,
    new_projection_bytes: input.positive.new_projection_bytes,
    new_projection_digest: input.positive.new_projection_digest,
    projection_bytes_equal: input.positive.projection_bytes_equal,
    projection_digests_equal: input.positive.projection_digests_equal,
    semantic_dimension_negatives: semanticDimensionNegatives,
    changed_paths: input.positive.changed_paths,
    fake_review_boundary: input.reviewBoundaryResults,
    repinning_result: input.positive.repinning_result,
    bundle_validation: input.positive.bundle_validation,
    protected_canary_receipt: {
      reference: input.protectedCanaryReceipt.reference,
      digest: input.protectedCanaryReceipt.digest,
    },
  };
}

export function validateBeanPublication(
  input: BeanPublicationInput,
): { status: "accepted" } | Rejected {
  if (input.embeddedThirdPartyNoticesRequired) {
    return {
      status: "rejected",
      reason: "unrepresentable_third_party_notice",
    };
  }
  if (!input.accepted || input.attestation !== OWNER_PUBLICATION_ATTESTATION) {
    return { status: "rejected", reason: "attestation_required" };
  }
  const expectedPaths = [input.beanPath, "roastery/index.json"].sort();
  if (
    !BEAN_PATH.test(input.beanPath) ||
    JSON.stringify([...input.changedPaths].sort()) !==
      JSON.stringify(expectedPaths)
  ) {
    return { status: "rejected", reason: "invalid_publication_paths" };
  }
  if (
    !COMMIT.test(input.headSha) ||
    !DIGEST.test(input.beanDigest) ||
    !DIGEST.test(input.changeSetDigest) ||
    input.attestedHeadSha !== input.headSha ||
    input.attestedBeanPath !== input.beanPath ||
    input.attestedBeanDigest !== input.beanDigest ||
    input.attestedChangeSetDigest !== input.changeSetDigest
  ) {
    return { status: "rejected", reason: "attestation_binding_mismatch" };
  }
  return { status: "accepted" };
}

export function validateAttributionCorrection(
  input: AttributionCorrectionInput,
):
  | {
      status: "accepted";
      beforeAttribution: string;
      afterAttribution: string;
    }
  | Rejected {
  if (
    !COMMIT.test(input.headSha) ||
    input.changedPaths.length !== 1 ||
    input.changedPaths[0] !== "roastery/CONTENT_LICENSE.md"
  ) {
    return { status: "rejected", reason: "protected_path_required" };
  }
  if (!exactOwnerHeadApproval(input.owner, input.headSha, input.reviews)) {
    return { status: "rejected", reason: "owner_review_required" };
  }

  const before = parseContentLicense(input.beforeBytes);
  const after = parseContentLicense(input.afterBytes);
  if (before.status !== "supported" || after.status !== "supported") {
    return { status: "rejected", reason: "scope_or_license_change" };
  }
  if (
    before.declaration.scope !== after.declaration.scope ||
    before.declaration.license !== after.declaration.license
  ) {
    return { status: "rejected", reason: "scope_or_license_change" };
  }
  if (before.declaration.attribution === after.declaration.attribution) {
    return { status: "rejected", reason: "attribution_unchanged" };
  }
  const preserved = new Set(input.priorGrantReceiptDigestsAfter);
  if (
    input.priorGrantReceiptDigestsBefore.some(
      (receipt) => !DIGEST.test(receipt) || !preserved.has(receipt),
    ) ||
    input.priorGrantReceiptDigestsAfter.some((receipt) => !DIGEST.test(receipt))
  ) {
    return { status: "rejected", reason: "prior_grant_revoked" };
  }
  return {
    status: "accepted",
    beforeAttribution: before.declaration.attribution,
    afterAttribution: after.declaration.attribution,
  };
}
