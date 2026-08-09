import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, test } from "vitest";

import {
  createSyntheticContractRefreshFixture,
  declarationBytes as validDeclarationBytes,
  sha256,
  type SemanticDimension,
  type SyntheticRefreshFixture,
} from "./helpers/synthetic-contract-refresh-fixture.js";

const roots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "..");
const dimensions: SemanticDimension[] = [
  "scope",
  "spdx_identifier",
  "official_license_url",
  "normalized_attribution",
  "status",
  "attribution_required",
  "change_indication_required",
  "product_provenance_required",
];

function canonicalEvidenceFixture() {
  const digest = `sha256:${"1".repeat(64)}`;
  return {
    status: "passed" as const,
    evidence_class: "fixture" as const,
    fixture_owner: "fixture-owner",
    synthetic_repositories: {
      a: {
        repository: "https://github.com/synthetic-fixture/contract-a",
        commit: "1".repeat(40),
        digest,
      },
      b: {
        repository: "https://github.com/synthetic-fixture/contract-b",
        commit: "2".repeat(40),
        digest,
      },
    },
    before_tree_digest: digest,
    after_tree_digest: digest,
    before_roastery_digest: digest,
    after_roastery_digest: digest,
    declaration_bytes: "declaration\n",
    declaration_digest: digest,
    old_projection_bytes: "old projection\n",
    old_projection_digest: digest,
    new_projection_bytes: "new projection\n",
    new_projection_digest: digest,
    projection_bytes_equal: true as const,
    projection_digests_equal: true as const,
    semantic_dimension_negatives: Object.fromEntries(
      dimensions.map((dimension) => [dimension, "rejected"]),
    ),
    changed_paths: [".coffee-chat/contract-pin.json"],
    fake_review_boundary: {
      missing: "rejected" as const,
      wrong_owner: "rejected" as const,
      stale_head: "rejected" as const,
      exact_owner_head: "accepted" as const,
    },
    repinning_result: "passed" as const,
    bundle_validation: { a: "passed" as const, b: "passed" as const },
    protected_canary_receipt: {
      reference: "fixture-canary",
      digest,
    },
  };
}

function remember(fixture: SyntheticRefreshFixture): SyntheticRefreshFixture {
  roots.push(fixture.root);
  return fixture;
}

function inputFrom(fixture: SyntheticRefreshFixture) {
  return {
    fixtureOwner: fixture.owner,
    forkRoot: fixture.forkRoot,
    beforeCommit: fixture.beforeCommit,
    candidateHead: fixture.candidateHead,
    changedPaths: fixture.changedPaths,
    reviews: fixture.reviews,
    oldBundle: fixture.oldBundle,
    newBundle: fixture.newBundle,
    pinPath: ".coffee-chat/contract-pin.json",
  };
}

function runReceiptBuilder(artifactDigest: string) {
  const root = mkdtempSync(resolve(tmpdir(), "contract-refresh-receipt-"));
  roots.push(root);
  const evidencePath = resolve(root, "evidence.json");
  const receiptPath = resolve(root, "receipt.json");
  writeFileSync(
    evidencePath,
    `${JSON.stringify(canonicalEvidenceFixture(), null, 2)}\n`,
  );
  const result = spawnSync(
    process.execPath,
    ["scripts/build-contract-refresh-receipt.mjs"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        CONTRACT_REFRESH_EVIDENCE_PATH: evidencePath,
        CONTRACT_REFRESH_EVIDENCE_ARTIFACT_ID: "42",
        CONTRACT_REFRESH_EVIDENCE_ARTIFACT_DIGEST: artifactDigest,
        CONTRACT_REFRESH_EVIDENCE_ARTIFACT_URL:
          "https://github.com/example/actions/runs/1/artifacts/42",
        CONTRACT_REFRESH_RECEIPT_OUTPUT: receiptPath,
        GITHUB_RUN_URL: "https://github.com/example/actions/runs/1",
      },
    },
  );
  return { result, receiptPath };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  for (const root of roots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

describe("protected contract refresh", () => {
  test("normalizes the upload-artifact bare digest once before writing the receipt", () => {
    const rawDigest = "3".repeat(64);

    const { result, receiptPath } = runReceiptBuilder(rawDigest);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({
      evidence_artifact: { digest: `sha256:${rawDigest}` },
    });
  });

  test.each([
    ["already prefixed", `sha256:${"3".repeat(64)}`],
    ["uppercase", "A".repeat(64)],
    ["short", "3".repeat(63)],
    ["non-hex", `${"3".repeat(63)}g`],
  ])("rejects %s upload-artifact digest input", (_name, digest) => {
    const { result, receiptPath } = runReceiptBuilder(digest);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/artifact digest is invalid/u);
    expect(existsSync(receiptPath)).toBe(false);
  });

  test("binds canonical evidence bytes and upload outputs in a final receipt envelope", async () => {
    const { buildContractRefreshReceiptEnvelope } =
      await import("../src/validation/repository.js");
    const evidence = canonicalEvidenceFixture();
    const evidenceBytes = `${JSON.stringify(evidence, null, 2)}\n`;
    const artifactDigest = `sha256:${"3".repeat(64)}`;

    expect(
      buildContractRefreshReceiptEnvelope({
        evidenceBytes,
        evidenceArtifact: {
          id: "42",
          digest: artifactDigest,
          url: "https://github.com/example/actions/runs/1/artifacts/42",
        },
        runUrl: "https://github.com/example/actions/runs/1",
      }),
    ).toEqual({
      status: "passed",
      evidence: {
        path: "artifacts/contract-refresh-evidence.json",
        digest: sha256(evidenceBytes),
      },
      evidence_artifact: {
        id: "42",
        digest: artifactDigest,
        url: "https://github.com/example/actions/runs/1/artifacts/42",
      },
      run_url: "https://github.com/example/actions/runs/1",
    });
    expect(() =>
      buildContractRefreshReceiptEnvelope({
        evidenceBytes: JSON.stringify(evidence),
        evidenceArtifact: {
          id: "42",
          digest: artifactDigest,
          url: "https://github.com/example/actions/runs/1/artifacts/42",
        },
        runUrl: "https://github.com/example/actions/runs/1",
      }),
    ).toThrow(/canonical evidence/u);
  });

  test("accepts equivalent independent bundles only with exact-head fixture-owner review", async () => {
    const fixture = remember(createSyntheticContractRefreshFixture());
    const { evaluateContractRefreshCandidate } =
      await import("../src/validation/repository.js");

    const result = await evaluateContractRefreshCandidate(inputFrom(fixture));

    expect(result).toMatchObject({
      status: "accepted",
      fixture_owner: "fixture-owner",
      changed_paths: [".coffee-chat/contract-pin.json"],
      declaration_digest: sha256(fixture.declarationBytes),
      projection_bytes_equal: true,
      projection_digests_equal: true,
      roastery_bytes_equal: true,
      repinning_result: "passed",
      bundle_validation: { a: "passed", b: "passed" },
    });
    expect(result).toHaveProperty(
      "old_bundle.commit",
      fixture.oldBundle.commit,
    );
    expect(result).toHaveProperty(
      "new_bundle.commit",
      fixture.newBundle.commit,
    );
    expect(result).toHaveProperty("old_projection_bytes");
    expect(result).toHaveProperty("new_projection_bytes");
  });

  test.each([
    {
      name: "missing review",
      mutate: (fixture: SyntheticRefreshFixture) => ({
        ...inputFrom(fixture),
        reviews: [],
      }),
      reason: "owner_review_required",
    },
    {
      name: "wrong owner review",
      mutate: (fixture: SyntheticRefreshFixture) => ({
        ...inputFrom(fixture),
        reviews: [
          {
            reviewer: "other-owner",
            headSha: fixture.candidateHead,
            state: "approved" as const,
          },
        ],
      }),
      reason: "owner_review_required",
    },
    {
      name: "stale head review",
      mutate: (fixture: SyntheticRefreshFixture) => ({
        ...inputFrom(fixture),
        reviews: [
          {
            reviewer: fixture.owner,
            headSha: fixture.beforeCommit,
            state: "approved" as const,
          },
        ],
      }),
      reason: "owner_review_required",
    },
  ])("rejects $name", async ({ mutate, reason }) => {
    const fixture = remember(createSyntheticContractRefreshFixture());
    const { evaluateContractRefreshCandidate } =
      await import("../src/validation/repository.js");
    await expect(
      evaluateContractRefreshCandidate(mutate(fixture)),
    ).resolves.toEqual({
      status: "rejected",
      reason,
    });
  });

  test.each(dimensions)(
    "rejects a %s rights-semantic interpretation change with declaration bytes unchanged",
    async (dimension) => {
      const fixture = remember(
        createSyntheticContractRefreshFixture(dimension),
      );
      const { evaluateContractRefreshCandidate } =
        await import("../src/validation/repository.js");

      const result = await evaluateContractRefreshCandidate(inputFrom(fixture));

      expect(result).toEqual({
        status: "rejected",
        reason: "rights_semantics_mismatch",
        dimensions: [dimension],
      });
    },
  );

  test.each([
    {
      name: "commit mismatch",
      mutate: (fixture: SyntheticRefreshFixture) => ({
        ...inputFrom(fixture),
        newBundle: { ...fixture.newBundle, commit: "0".repeat(40) },
      }),
      reason: "bundle_commit_mismatch",
    },
    {
      name: "digest mismatch",
      mutate: (fixture: SyntheticRefreshFixture) => ({
        ...inputFrom(fixture),
        newBundle: {
          ...fixture.newBundle,
          digest: `sha256:${"0".repeat(64)}` as const,
        },
      }),
      reason: "bundle_digest_mismatch",
    },
    {
      name: "owner mismatch",
      mutate: (fixture: SyntheticRefreshFixture) => ({
        ...inputFrom(fixture),
        fixtureOwner: "wrong-owner",
      }),
      reason: "fixture_owner_mismatch",
    },
    {
      name: "head mismatch",
      mutate: (fixture: SyntheticRefreshFixture) => ({
        ...inputFrom(fixture),
        candidateHead: fixture.beforeCommit,
      }),
      reason: "candidate_head_mismatch",
    },
    {
      name: "changed-path mismatch",
      mutate: (fixture: SyntheticRefreshFixture) => ({
        ...inputFrom(fixture),
        changedPaths: [".coffee-chat/contract-pin.json", "roastery/index.json"],
      }),
      reason: "changed_paths_mismatch",
    },
  ])("fails closed on $name", async ({ mutate, reason }) => {
    const fixture = remember(createSyntheticContractRefreshFixture());
    const { evaluateContractRefreshCandidate } =
      await import("../src/validation/repository.js");
    await expect(
      evaluateContractRefreshCandidate(mutate(fixture)),
    ).resolves.toEqual({
      status: "rejected",
      reason,
    });
  });

  test.each([
    {
      name: "an extra final LF",
      bytes: `${validDeclarationBytes}\n`,
    },
    {
      name: "invalid UTF-8",
      bytes: Buffer.concat([
        Buffer.from(validDeclarationBytes),
        Buffer.from([0xc3, 0x28]),
      ]),
    },
  ])(
    "rejects exact declaration blob bytes containing $name",
    async ({ bytes }) => {
      const fixture = remember(
        createSyntheticContractRefreshFixture(undefined, {
          declarationBytes: bytes,
        }),
      );
      const { evaluateContractRefreshCandidate } =
        await import("../src/validation/repository.js");

      await expect(
        evaluateContractRefreshCandidate(inputFrom(fixture)),
      ).resolves.toEqual({
        status: "rejected",
        reason: "invalid_declaration",
      });
    },
  );

  test("rejects two digest-bound bundles carrying the same alternate policy", async () => {
    const fixture = remember(
      createSyntheticContractRefreshFixture("spdx_identifier", {
        oldDimension: "spdx_identifier",
      }),
    );
    const { evaluateContractRefreshCandidate } =
      await import("../src/validation/repository.js");

    await expect(
      evaluateContractRefreshCandidate(inputFrom(fixture)),
    ).resolves.toEqual({
      status: "rejected",
      reason: "old_bundle_policy_invalid",
    });
  });

  test.each([
    {
      name: "content-license schema",
      mutate(root: string) {
        const path = resolve(
          root,
          "contract/schemas/content-license.schema.json",
        );
        const schema = JSON.parse(readFileSync(path, "utf8"));
        schema.properties.license.const = "CC0-1.0";
        writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
      },
    },
    {
      name: "declaration template",
      mutate(root: string) {
        const path = resolve(root, "contract/templates/content-license.md");
        writeFileSync(path, `${readFileSync(path, "utf8")}drift\n`);
      },
    },
    {
      name: "declared security artifact",
      mutate(root: string) {
        rmSync(resolve(root, "contract/security.md"));
      },
    },
  ])("rejects drift in the new bundle's $name", async ({ mutate }) => {
    const fixture = remember(
      createSyntheticContractRefreshFixture(undefined, {
        mutateNewBundle: mutate,
      }),
    );
    const { evaluateContractRefreshCandidate } =
      await import("../src/validation/repository.js");

    await expect(
      evaluateContractRefreshCandidate(inputFrom(fixture)),
    ).resolves.toEqual({
      status: "rejected",
      reason: "new_bundle_validation_failed",
    });
  });

  test("rejects receipt evidence whose negative result names another dimension", async () => {
    const fixture = remember(createSyntheticContractRefreshFixture());
    const { buildContractRefreshEvidence, evaluateContractRefreshCandidate } =
      await import("../src/validation/repository.js");
    const positive = await evaluateContractRefreshCandidate(inputFrom(fixture));
    const negatives = Object.fromEntries(
      dimensions.map((dimension) => [
        dimension,
        {
          status: "rejected" as const,
          reason: "rights_semantics_mismatch",
          dimensions: [dimension],
        },
      ]),
    );
    negatives.scope = {
      status: "rejected",
      reason: "rights_semantics_mismatch",
      dimensions: ["status"],
    };

    await expect(
      buildContractRefreshEvidence({
        positive,
        semanticDimensionNegatives: negatives,
        reviewBoundaryResults: {
          missing: "rejected",
          wrong_owner: "rejected",
          stale_head: "rejected",
          exact_owner_head: "accepted",
        },
        protectedCanaryReceipt: {
          root: repositoryRoot,
          reference:
            "docs/engineering/receipts/2026-08-09-coffee-chat-roastery-github-policy.md",
          digest:
            "sha256:5f3c4bd01c4b3fa29f7b8f362d4bbf1e2e5fdbb4eaca38734d3a385965f85370",
        },
      }),
    ).rejects.toThrow(/scope/u);
  });

  test("fails closed on dirty bundle bytes and pin projection byte or digest mismatch", async () => {
    const { evaluateContractRefreshCandidate } =
      await import("../src/validation/repository.js");
    const dirty = remember(createSyntheticContractRefreshFixture());
    writeFileSync(
      resolve(dirty.newBundle.root, "contract/security.md"),
      "dirty bundle bytes\n",
    );
    await expect(
      evaluateContractRefreshCandidate(inputFrom(dirty)),
    ).resolves.toEqual({ status: "rejected", reason: "bundle_byte_mismatch" });

    for (const field of [
      "rights_semantics_bytes",
      "rights_semantics_digest",
    ] as const) {
      const fixture = remember(createSyntheticContractRefreshFixture());
      const pinPath = resolve(
        fixture.forkRoot,
        ".coffee-chat/contract-pin.json",
      );
      const pin = JSON.parse(
        await (await import("node:fs/promises")).readFile(pinPath, "utf8"),
      );
      pin[field] = field.endsWith("bytes")
        ? "mismatch\n"
        : `sha256:${"0".repeat(64)}`;
      writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
      const { execFileSync } = await import("node:child_process");
      execFileSync("git", ["-C", fixture.forkRoot, "add", pinPath]);
      execFileSync("git", [
        "-C",
        fixture.forkRoot,
        "commit",
        "--quiet",
        "-m",
        `mismatch ${field}`,
      ]);
      fixture.candidateHead = execFileSync(
        "git",
        ["-C", fixture.forkRoot, "rev-parse", "HEAD"],
        { encoding: "utf8" },
      ).trim();
      fixture.reviews = [
        {
          reviewer: fixture.owner,
          headSha: fixture.candidateHead,
          state: "approved",
        },
      ];
      await expect(
        evaluateContractRefreshCandidate(inputFrom(fixture)),
      ).resolves.toMatchObject({
        status: "rejected",
        reason: "projection_pin_mismatch",
      });
    }
  });

  // This bounded objective creates 27 local Git repositories and independently
  // compiles A/B schema state for nine cases. Keep its budget local; no retries
  // or global timeout expansion may hide a failing required command.
  test("builds canonical schema-valid evidence and an artifact-bound receipt", async () => {
    const positiveFixture = remember(createSyntheticContractRefreshFixture());
    const {
      buildContractRefreshEvidence,
      buildContractRefreshReceiptEnvelope,
      evaluateContractRefreshCandidate,
      serializeContractRefreshEvidence,
    } = await import("../src/validation/repository.js");
    const positive = await evaluateContractRefreshCandidate(
      inputFrom(positiveFixture),
    );
    expect(positive.status).toBe("accepted");

    const negatives = Object.fromEntries(
      await Promise.all(
        dimensions.map(async (dimension) => {
          const fixture = remember(
            createSyntheticContractRefreshFixture(dimension),
          );
          return [
            dimension,
            await evaluateContractRefreshCandidate(inputFrom(fixture)),
          ];
        }),
      ),
    );
    const evidenceInput = {
      positive,
      semanticDimensionNegatives: negatives,
      reviewBoundaryResults: {
        missing: "rejected",
        wrong_owner: "rejected",
        stale_head: "rejected",
        exact_owner_head: "accepted",
      },
      protectedCanaryReceipt: {
        root: repositoryRoot,
        reference:
          "docs/engineering/receipts/2026-08-09-coffee-chat-roastery-github-policy.md",
        digest:
          "sha256:5f3c4bd01c4b3fa29f7b8f362d4bbf1e2e5fdbb4eaca38734d3a385965f85370",
      },
    } as const;
    await expect(
      Promise.resolve(
        buildContractRefreshEvidence({
          ...evidenceInput,
          protectedCanaryReceipt: {
            ...evidenceInput.protectedCanaryReceipt,
            reference: "docs/engineering/receipts/missing-canary.md",
          },
        }),
      ),
    ).rejects.toThrow(/canary receipt is unavailable/u);
    const evidence = await buildContractRefreshEvidence(evidenceInput);
    const evidenceBytes = serializeContractRefreshEvidence(evidence);
    const receipt = buildContractRefreshReceiptEnvelope({
      evidenceBytes,
      evidenceArtifact: {
        id: "42",
        digest: sha256("uploaded evidence archive"),
        url: "https://github.com/openboa-ai/coffee-chat-roastery/actions/runs/fixture/artifacts/42",
      },
      runUrl:
        process.env.GITHUB_RUN_URL ??
        "https://github.com/openboa-ai/coffee-chat-roastery/actions/runs/fixture",
    });
    const { readFile } = await import("node:fs/promises");
    const evidenceSchema = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../contract/schemas/contract-refresh-evidence.schema.json",
        ),
        "utf8",
      ),
    );
    const receiptSchema = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../contract/schemas/contract-refresh-receipt.schema.json",
        ),
        "utf8",
      ),
    );
    const ajv = new Ajv2020.default({
      allErrors: true,
      strict: true,
    });
    const validateEvidence = ajv.compile(evidenceSchema);
    const validateReceipt = ajv.compile(receiptSchema);

    expect(
      validateEvidence(evidence),
      JSON.stringify(validateEvidence.errors),
    ).toBe(true);
    expect(
      validateReceipt(receipt),
      JSON.stringify(validateReceipt.errors),
    ).toBe(true);
    expect(evidence.semantic_dimension_negatives).toEqual(
      Object.fromEntries(
        dimensions.map((dimension) => [dimension, "rejected"]),
      ),
    );
    expect(evidence.declaration_bytes).toBe(positiveFixture.declarationBytes);
    expect(receipt.evidence.digest).toBe(sha256(evidenceBytes));

    const output = process.env.CONTRACT_REFRESH_EVIDENCE_OUTPUT;
    if (output !== undefined) writeFileSync(output, evidenceBytes);
  }, 20_000);
});
