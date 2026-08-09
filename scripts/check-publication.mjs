#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  OWNER_PUBLICATION_ATTESTATION,
  validateBeanPublication,
  validateRepository,
} from "../src/validation/repository.ts";

const ATTESTATION_SCHEMA = "coffee-chat/bean-publication-attestation";
const BEAN_PATH =
  /^roastery\/beans\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTRACT_REPOSITORY =
  "https://github.com/openboa-ai/coffee-chat-roastery";

/**
 * @typedef {{
 *   kind: "pull_request" | "merge_group";
 *   baseSha: string;
 *   headSha: string;
 *   body: string;
 * }} GitHubEvent
 */

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * @param {string} reason
 * @returns {never}
 */
function fail(reason) {
  throw new Error(reason);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort())
  );
}

function gitText(root, arguments_) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitBytes(root, arguments_) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * @param {string} path
 * @param {string | undefined} eventName
 * @returns {GitHubEvent}
 */
function parseEvent(path, eventName) {
  let event;
  try {
    event = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("invalid_github_event");
  }
  if (eventName === "pull_request") {
    const pullRequest = event?.pull_request;
    const baseSha = pullRequest?.base?.sha;
    const headSha = pullRequest?.head?.sha;
    if (!COMMIT.test(baseSha ?? "") || !COMMIT.test(headSha ?? "")) {
      fail("invalid_github_event");
    }
    return {
      kind: "pull_request",
      baseSha,
      headSha,
      body: typeof pullRequest.body === "string" ? pullRequest.body : "",
    };
  }
  if (eventName === "merge_group") {
    const baseSha = event?.merge_group?.base_sha;
    const headSha = event?.merge_group?.head_sha;
    if (!COMMIT.test(baseSha ?? "") || !COMMIT.test(headSha ?? "")) {
      fail("invalid_github_event");
    }
    return { kind: "merge_group", baseSha, headSha, body: "" };
  }
  fail("unsupported_github_event");
}

function changedPaths(root, baseSha, headSha) {
  return gitBytes(root, [
    "diff",
    "--name-only",
    "--diff-filter=ACMRD",
    "-z",
    baseSha,
    headSha,
    "--",
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function readHeadFile(root, headSha, path) {
  const treeEntry = gitText(root, ["ls-tree", headSha, "--", path]);
  if (
    !treeEntry.startsWith("100644 blob ") ||
    !treeEntry.endsWith(`\t${path}`)
  ) {
    fail("invalid_publication_file");
  }
  return gitBytes(root, ["show", `${headSha}:${path}`]);
}

function publicationChangeSetDigest(root, headSha, paths) {
  const hash = createHash("sha256");
  for (const path of paths) {
    const pathBytes = Buffer.from(path);
    const contentBytes = readHeadFile(root, headSha, path);
    const pathLength = Buffer.alloc(4);
    pathLength.writeUInt32BE(pathBytes.length);
    const contentLength = Buffer.alloc(8);
    contentLength.writeBigUInt64BE(BigInt(contentBytes.length));
    hash
      .update(pathLength)
      .update(pathBytes)
      .update(contentLength)
      .update(contentBytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function parseAttestation(body) {
  const blocks = [
    ...body.matchAll(/<!-- coffee-chat-publication\n([\s\S]*?)\n-->/gu),
  ];
  if (blocks.length !== 1 || (blocks[0]?.[1]?.length ?? 0) > 8192) {
    fail("attestation_required");
  }
  let value;
  try {
    value = JSON.parse(blocks[0][1]);
  } catch {
    fail("attestation_required");
  }
  const keys = [
    "schema",
    "head_sha",
    "bean_path",
    "bean_digest",
    "change_set_digest",
    "attestation",
    "accepted",
    "embedded_third_party_notices_required",
  ];
  if (
    !isRecord(value) ||
    !exactKeys(value, keys) ||
    value.schema !== ATTESTATION_SCHEMA ||
    typeof value.head_sha !== "string" ||
    typeof value.bean_path !== "string" ||
    typeof value.bean_digest !== "string" ||
    typeof value.change_set_digest !== "string" ||
    typeof value.attestation !== "string" ||
    typeof value.accepted !== "boolean" ||
    typeof value.embedded_third_party_notices_required !== "boolean"
  ) {
    fail("attestation_required");
  }
  return value;
}

function trustedContract(environment) {
  const repository = environment.ROASTERY_TRUSTED_CONTRACT_REPOSITORY;
  const commit = environment.ROASTERY_TRUSTED_CONTRACT_COMMIT;
  const digest = environment.ROASTERY_TRUSTED_CONTRACT_DIGEST;
  if (
    repository !== CONTRACT_REPOSITORY ||
    !COMMIT.test(commit ?? "") ||
    !DIGEST.test(digest ?? "")
  ) {
    fail("trusted_contract_required");
  }
  return { repository, commit, digest };
}

async function main() {
  const root = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined) fail("invalid_github_event");
  const event = parseEvent(eventPath, process.env.GITHUB_EVENT_NAME);
  if (gitText(root, ["rev-parse", "HEAD"]) !== event.headSha) {
    fail("checked_out_head_mismatch");
  }
  if (gitText(root, ["status", "--porcelain", "--untracked-files=no"]) !== "") {
    fail("checked_out_tree_mismatch");
  }
  const paths = changedPaths(root, event.baseSha, event.headSha);
  const roasteryPaths = paths.filter((path) => path.startsWith("roastery/"));
  if (roasteryPaths.length === 0) {
    emit({ status: "not_applicable", reason: "no_roastery_change" });
    return;
  }
  if (event.kind !== "pull_request") {
    fail("publication_attestation_unavailable");
  }
  const beanPaths = roasteryPaths.filter((path) => BEAN_PATH.test(path));
  const beanPath = beanPaths[0];
  if (beanPaths.length !== 1 || beanPath === undefined) {
    fail("invalid_publication_paths");
  }
  const attestation = parseAttestation(event.body);
  const expectedContract = trustedContract(process.env);
  const repositoryResult = await validateRepository(root, expectedContract);
  if (repositoryResult.status !== "valid") fail(repositoryResult.reason);
  const beanBytes = readHeadFile(root, event.headSha, beanPath);
  const beanDigest = `sha256:${createHash("sha256")
    .update(beanBytes)
    .digest("hex")}`;
  const changeSetDigest = publicationChangeSetDigest(
    root,
    event.headSha,
    paths,
  );
  const result = validateBeanPublication({
    headSha: event.headSha,
    changedPaths: paths,
    beanPath,
    beanDigest,
    attestedBeanDigest: attestation.bean_digest,
    changeSetDigest,
    attestedChangeSetDigest: attestation.change_set_digest,
    attestedHeadSha: attestation.head_sha,
    attestation: attestation.attestation,
    accepted: attestation.accepted,
    embeddedThirdPartyNoticesRequired:
      attestation.embedded_third_party_notices_required,
  });
  if (result.status !== "accepted") fail(result.reason);
  emit({
    status: "accepted",
    head_sha: event.headSha,
    bean_path: beanPath,
    bean_digest: beanDigest,
    change_set_digest: changeSetDigest,
    attestation: OWNER_PUBLICATION_ATTESTATION,
  });
}

main().catch((error) => {
  const reason =
    error instanceof Error && /^[a-z0-9_]+$/u.test(error.message)
      ? error.message
      : "publication_check_failed";
  emit({ status: "rejected", reason });
  process.exitCode = 1;
});
