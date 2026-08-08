#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { Ajv } from "ajv";

const defaultPaths = {
  projection: "docs/migration/selections/task-4-governance-trust-base.json",
  equality: "docs/migration/equality/task-4-governance-trust-base.json",
  receipt: "docs/migration/receipts/task-4-governance-trust-base.json",
};

const identityFields = [
  "source_repository",
  "source_ref",
  "source_commit",
  "source_path",
];

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function parseArguments(argv) {
  const allowed = new Set([
    "--root",
    "--base",
    "--target",
    "--projection",
    "--equality",
    "--receipt",
  ]);
  if (argv.length % 2 !== 0) fail("arguments must be flag/value pairs");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !allowed.has(flag) || values.has(flag) || !value) {
      fail("unknown, duplicate, or missing argument");
    }
    values.set(flag, value);
  }
  if (!values.has("--root") || !values.has("--base")) {
    fail("--root and --base are required");
  }
  const root = resolve(values.get("--root"));
  return {
    root,
    base: values.get("--base"),
    target: values.get("--target"),
    projectionPath: resolve(
      root,
      values.get("--projection") ?? defaultPaths.projection,
    ),
    equalityPath: resolve(
      root,
      values.get("--equality") ?? defaultPaths.equality,
    ),
    receiptPath: resolve(root, values.get("--receipt") ?? defaultPaths.receipt),
  };
}

function readJson(path) {
  const bytes = readFileSync(path);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

function validate(validator, value, label) {
  if (validator(value)) return;
  const details = (validator.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
  fail(`${label} schema validation failed: ${details}`);
}

function identityKey(value) {
  return identityFields.map((field) => value[field]).join("\u0000");
}

function exactArray(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(
      `${label} mismatch\nactual=${JSON.stringify(actual)}\nexpected=${JSON.stringify(expected)}`,
    );
  }
}

function gitText(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitZeroSeparated(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "buffer",
  });
  if (result.status !== 0) {
    fail(Buffer.from(result.stderr).toString("utf8").trim());
  }
  return Buffer.from(result.stdout)
    .toString("utf8")
    .split("\u0000")
    .filter(Boolean);
}

function changedSurfaces(root, base, target) {
  if (target) {
    return gitZeroSeparated(root, [
      "diff",
      "--name-only",
      "--diff-filter=ACMRD",
      "-z",
      base,
      target,
      "--",
    ]).sort();
  }
  const paths = new Set([
    ...gitZeroSeparated(root, [
      "diff",
      "--name-only",
      "--diff-filter=ACMRD",
      "-z",
      base,
      "--",
    ]),
    ...gitZeroSeparated(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]),
  ]);
  return [...paths].sort();
}

function assertEvidenceReferences(root, entries, packageJson, allowedCommands) {
  const rootRealPath = realpathSync(root);
  const commands = new Set();
  for (const entry of entries) {
    if (entry.startsWith("path:")) {
      const path = entry.slice("path:".length);
      if (!path || isAbsolute(path)) {
        fail(
          `rewrite evidence path must remain inside the repository: ${path}`,
        );
      }
      const candidatePath = resolve(root, path);
      let candidateRealPath;
      try {
        if (!lstatSync(candidatePath).isFile()) {
          fail(`rewrite evidence path is not a regular file: ${path}`);
        }
        candidateRealPath = realpathSync(candidatePath);
      } catch (error) {
        fail(
          `rewrite evidence path is unavailable: ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const repositoryRelativePath = relative(rootRealPath, candidateRealPath);
      if (
        !repositoryRelativePath ||
        repositoryRelativePath === ".." ||
        repositoryRelativePath.startsWith(
          `..${process.platform === "win32" ? "\\" : "/"}`,
        ) ||
        isAbsolute(repositoryRelativePath)
      ) {
        fail(
          `rewrite evidence path must remain inside the repository: ${path}`,
        );
      }
      continue;
    }
    if (entry.startsWith("command:")) {
      const command = entry.slice("command:".length);
      if (
        !command ||
        !(command in packageJson.scripts) ||
        !allowedCommands.has(command)
      ) {
        fail(`rewrite evidence command is unavailable: ${command}`);
      }
      commands.add(command);
      continue;
    }
    fail(`rewrite evidence has an unknown reference: ${entry}`);
  }
  if (commands.size !== 1) {
    fail("each rewrite row must declare exactly one reviewed oracle command");
  }
  return commands;
}

function runRewriteOracles(root, commands) {
  for (const command of [...commands].sort()) {
    const result = spawnSync("npm", ["run", "--silent", command], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      timeout: 60_000,
    });
    if (result.error || result.status !== 0) {
      const detail = result.error?.message || result.stderr || result.stdout;
      fail(`rewrite oracle failed: ${command}: ${String(detail).trim()}`);
    }
  }
}

async function fetchPinnedSource(row) {
  const encodedPath = row.source_path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url =
    `https://api.github.com/repos/${row.source_repository}/contents/` +
    `${encodedPath}?ref=${encodeURIComponent(row.source_commit)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "openboa-ai-coffee-chat-roastery-migration-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) fail(`pinned source fetch failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (
    !payload ||
    Array.isArray(payload) ||
    payload.type !== "file" ||
    payload.encoding !== "base64" ||
    typeof payload.content !== "string"
  ) {
    fail("pinned source response is not one base64 file");
  }
  if (payload.sha !== row.source_blob_oid) {
    fail(`pinned source blob mismatch for ${row.source_path}`);
  }
  return Buffer.from(payload.content.replace(/\s/gu, ""), "base64");
}

async function verifyMigrateRows(root, rows, evidence) {
  const byIdentity = new Map(
    evidence.map((entry) => [identityKey(entry), entry]),
  );
  if (byIdentity.size !== evidence.length || evidence.length !== rows.length) {
    fail("migrate evidence cardinality mismatch");
  }
  for (const row of rows) {
    const entry = byIdentity.get(identityKey(row));
    if (!entry) fail(`missing migrate evidence for ${row.source_path}`);
    if (entry.status !== "passed")
      fail(`migrate evidence did not pass: ${row.source_path}`);
    if (
      entry.source_blob_oid !== row.source_blob_oid ||
      entry.source_sha256 !== row.content_sha256 ||
      entry.target_path !== row.target_path_or_surface
    ) {
      fail(`migrate evidence field mismatch: ${row.source_path}`);
    }
    const sourceBytes = await fetchPinnedSource(row);
    const sourceDigest = sha256(sourceBytes);
    const targetBytes = readFileSync(resolve(root, entry.target_path));
    const targetDigest = sha256(targetBytes);
    if (
      sourceDigest !== row.content_sha256 ||
      targetDigest !== entry.target_sha256 ||
      targetDigest !== sourceDigest
    ) {
      fail(`migrate byte equality failed: ${row.source_path}`);
    }
  }
}

function verifyRewriteRows(root, rows, evidence, packageJson, allowedCommands) {
  const byIdentity = new Map(
    evidence.map((entry) => [identityKey(entry), entry]),
  );
  if (byIdentity.size !== evidence.length || evidence.length !== rows.length) {
    fail("rewrite evidence cardinality mismatch");
  }
  const commands = new Set();
  for (const row of rows) {
    const entry = byIdentity.get(identityKey(row));
    if (!entry) fail(`missing rewrite evidence for ${row.source_path}`);
    for (const field of [
      "rationale_code",
      "oracle_code",
      "source_objective_or_failure_mode",
      "replacement_observable_oracle",
    ]) {
      if (entry[field] !== row[field]) {
        fail(`rewrite evidence ${field} mismatch: ${row.source_path}`);
      }
    }
    if (entry.status !== "passed") {
      fail(`rewrite evidence did not pass: ${row.source_path}`);
    }
    for (const command of assertEvidenceReferences(
      root,
      entry.evidence,
      packageJson,
      allowedCommands,
    )) {
      commands.add(command);
    }
  }
  runRewriteOracles(root, commands);
}

function assertReviewedAuthority(projection, equality, receipt, mergePolicy) {
  const authority = mergePolicy.migration?.reviewed_authority;
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
    fail("reviewed migration authority is unavailable");
  }
  const expectedFields = [
    "target_owner",
    "task",
    "objective",
    "ledger_sha256",
    "generator_sha256",
    "objective_selection_sha256",
    "projection_sha256",
    "changed_surface_classification_sha256",
    "equality_receipt_sha256",
    "execution_identity_receipt_sha256",
    "target_bootstrap_receipt_sha256",
    "changed_surfaces_sha256",
    "selected_rows",
    "changed_surfaces",
  ];
  exactArray(
    Object.keys(authority).sort(),
    [...expectedFields].sort(),
    "reviewed migration authority fields",
  );
  const comparisons = {
    target_owner: projection.value.target_owner,
    task: projection.value.task,
    objective: projection.value.objective,
    ledger_sha256: projection.value.ledger_sha256,
    generator_sha256: equality.value.generator_sha256,
    objective_selection_sha256: equality.value.objective_selection_sha256,
    projection_sha256: sha256(projection.bytes),
    changed_surface_classification_sha256:
      equality.value.changed_surface_classification_sha256,
    equality_receipt_sha256: sha256(equality.bytes),
    execution_identity_receipt_sha256:
      receipt.value.execution_identity_receipt_sha256,
    target_bootstrap_receipt_sha256:
      receipt.value.target_bootstrap_receipt_sha256,
    changed_surfaces_sha256: receipt.value.changed_surfaces_sha256,
    selected_rows: projection.value.selected_rows.length,
    changed_surfaces: projection.value.changed_surface_classification.length,
  };
  for (const [field, actual] of Object.entries(comparisons)) {
    if (authority[field] !== actual) {
      fail(`reviewed migration authority mismatch: ${field}`);
    }
  }
}

function verifyExcludeRows(root, rows, evidence) {
  const byIdentity = new Map(
    evidence.map((entry) => [identityKey(entry), entry]),
  );
  if (byIdentity.size !== evidence.length || evidence.length !== rows.length) {
    fail("exclude evidence cardinality mismatch");
  }
  const tracked = new Set(gitZeroSeparated(root, ["ls-files", "-z"]));
  for (const row of rows) {
    const entry = byIdentity.get(identityKey(row));
    if (!entry) fail(`missing exclude evidence for ${row.source_path}`);
    if (entry.status !== "passed")
      fail(`exclude evidence did not pass: ${row.source_path}`);
    for (const path of entry.checked_target_paths) {
      if (tracked.has(path) || existsSync(resolve(root, path))) {
        fail(`excluded surface is present: ${path}`);
      }
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const projection = readJson(args.projectionPath);
  const equality = readJson(args.equalityPath);
  const receipt = readJson(args.receiptPath);
  const packageJson = JSON.parse(
    readFileSync(resolve(args.root, "package.json"), "utf8"),
  );
  const mergePolicy = JSON.parse(
    readFileSync(resolve(args.root, ".github/merge-policy.json"), "utf8"),
  );

  const ajv = new Ajv({ allErrors: true, strict: true });
  const selectionSchema = JSON.parse(
    readFileSync(
      resolve(args.root, ".github/migration-selection.schema.json"),
      "utf8",
    ),
  );
  const equalitySchema = JSON.parse(
    readFileSync(
      resolve(args.root, ".github/migration-equality-receipt.schema.json"),
      "utf8",
    ),
  );
  const receiptSchema = JSON.parse(
    readFileSync(
      resolve(args.root, ".github/migration-receipt.schema.json"),
      "utf8",
    ),
  );
  validate(ajv.compile(selectionSchema), projection.value, "projection");
  validate(ajv.compile(equalitySchema), equality.value, "equality receipt");
  validate(ajv.compile(receiptSchema), receipt.value, "target receipt");
  assertReviewedAuthority(projection, equality, receipt, mergePolicy);

  for (const field of ["target_owner", "task", "objective", "ledger_sha256"]) {
    if (projection.value[field] !== equality.value[field]) {
      fail(`projection/equality ${field} mismatch`);
    }
  }
  for (const field of ["target_owner", "task", "objective"]) {
    if (projection.value[field] !== receipt.value[field]) {
      fail(`projection/receipt ${field} mismatch`);
    }
  }

  const projectionDigest = sha256(projection.bytes);
  if (
    equality.value.projection_sha256 !== projectionDigest ||
    receipt.value.projection_sha256 !== projectionDigest
  ) {
    fail("projection digest mismatch");
  }
  if (receipt.value.equality_receipt_sha256 !== sha256(equality.bytes)) {
    fail("equality receipt digest mismatch");
  }
  const classificationDigest = sha256(
    canonicalJson({
      target_owner: projection.value.target_owner,
      task: projection.value.task,
      objective: projection.value.objective,
      changed_surface_classification:
        projection.value.changed_surface_classification,
    }),
  );
  if (
    equality.value.changed_surface_classification_sha256 !==
    classificationDigest
  ) {
    fail("changed-surface classification digest mismatch");
  }

  const selectedKeys = new Set(projection.value.selected_rows.map(identityKey));
  const referencedKeys = new Set();
  const classifiedSurfaces = [];
  for (const entry of projection.value.changed_surface_classification) {
    classifiedSurfaces.push(entry.target_path_or_surface);
    if (entry.classification !== "ledger-derived") continue;
    for (const identity of entry.selected_rows) {
      const key = identityKey(identity);
      if (!selectedKeys.has(key))
        fail("classification references an unselected row");
      referencedKeys.add(key);
    }
  }
  if (
    referencedKeys.size !== selectedKeys.size ||
    [...selectedKeys].some((key) => !referencedKeys.has(key))
  ) {
    fail("one or more selected rows lack changed-surface evidence");
  }

  const actualSurfaces = changedSurfaces(args.root, args.base, args.target);
  const expectedSurfaces = [...classifiedSurfaces].sort();
  if (new Set(expectedSurfaces).size !== expectedSurfaces.length) {
    fail("changed-surface classification contains a duplicate target");
  }
  exactArray(actualSurfaces, expectedSurfaces, "changed surfaces");
  exactArray(
    receipt.value.changed_surfaces,
    expectedSurfaces,
    "receipt surfaces",
  );
  if (
    receipt.value.changed_surfaces_sha256 !==
    sha256(canonicalJson(expectedSurfaces))
  ) {
    fail("changed-surface receipt digest mismatch");
  }

  const resolvedBase = gitText(args.root, [
    "rev-parse",
    `${args.base}^{commit}`,
  ]);
  if (resolvedBase !== args.base || receipt.value.base_commit !== args.base) {
    fail("empty base commit mismatch");
  }
  if (args.target) {
    const resolvedTarget = gitText(args.root, [
      "rev-parse",
      `${args.target}^{commit}`,
    ]);
    if (resolvedTarget !== args.target) {
      fail("trust-base target commit mismatch");
    }
    if (
      gitText(args.root, ["show", "-s", "--format=%P", args.target]) !==
      args.base
    ) {
      fail("trust-base target must have only the empty base as its parent");
    }
  }
  if (gitText(args.root, ["show", "-s", "--format=%P", args.base]) !== "") {
    fail("bootstrap base is not a root commit");
  }
  const baseTree = gitText(args.root, ["rev-parse", `${args.base}^{tree}`]);
  if (
    baseTree !== "4b825dc642cb6eb9a060e54bf8d69288fbee4904" ||
    receipt.value.empty_base_tree !== baseTree
  ) {
    fail("bootstrap base is not the canonical empty tree");
  }
  const baseIdentity = gitText(args.root, [
    "show",
    "-s",
    "--format=%an%n%ae%n%cn%n%ce",
    args.base,
  ]).split("\n");
  exactArray(
    baseIdentity,
    [
      "SonSangjoon",
      "74908906+SonSangjoon@users.noreply.github.com",
      "SonSangjoon",
      "74908906+SonSangjoon@users.noreply.github.com",
    ],
    "empty base identity",
  );

  const rows = projection.value.selected_rows;
  await verifyMigrateRows(
    args.root,
    rows.filter((row) => row.action === "migrate"),
    receipt.value.migrate_evidence,
  );
  verifyRewriteRows(
    args.root,
    rows.filter((row) => row.action === "rewrite"),
    receipt.value.rewrite_evidence,
    packageJson,
    new Set(mergePolicy.migration.oracle_commands ?? []),
  );
  verifyExcludeRows(
    args.root,
    rows.filter((row) => row.action === "exclude"),
    receipt.value.exclude_evidence,
  );
  if (receipt.value.verification.local_deterministic !== "passed") {
    fail("local deterministic verification is not passed");
  }

  process.stdout.write(
    JSON.stringify({
      status: "passed",
      target_owner: projection.value.target_owner,
      task: projection.value.task,
      objective: projection.value.objective,
      target_commit: args.target ?? null,
      selected_rows: rows.length,
      changed_surfaces: expectedSurfaces.length,
    }) + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(
    error instanceof Error ? `${error.message}\n` : `${error}\n`,
  );
  process.exitCode = 1;
});
