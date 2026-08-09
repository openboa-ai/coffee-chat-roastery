import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { fakeGithubReviews } from "./helpers/fake-github-review-boundary.js";

const temporaryRoots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "..");
const publicationCheckPath = resolve(
  repositoryRoot,
  "scripts/check-publication.mjs",
);
const beanId = "01890f3a-2b00-7000-8000-000000000001";

interface PublicationFixture {
  root: string;
  eventPath: string;
  baseSha: string;
  headSha: string;
  beanPath: string;
  beanBytes: string;
  indexBytes: string;
  contractDigest: string;
}

function framedChangeSetDigest(
  files: Array<{ path: string; bytes: string }>,
): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) =>
    Buffer.from(a.path).compare(Buffer.from(b.path)),
  )) {
    const path = Buffer.from(file.path);
    const bytes = Buffer.from(file.bytes);
    const pathLength = Buffer.alloc(4);
    pathLength.writeUInt32BE(path.length);
    const contentLength = Buffer.alloc(8);
    contentLength.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(pathLength).update(path).update(contentLength).update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function publicationFixture(): Promise<PublicationFixture> {
  const root = mkdtempSync(join(tmpdir(), "roastery-publication-check-"));
  temporaryRoots.push(root);
  cpSync(resolve(repositoryRoot, "contract"), join(root, "contract"), {
    recursive: true,
  });
  mkdirSync(join(root, "roastery", "beans"), { recursive: true });
  const { digestContractBundle } = await import("../src/contract/digest.js");
  const { renderContentLicense } =
    await import("../src/projection/content-license.js");
  const contractDigest = await digestContractBundle(root);
  writeFileSync(
    join(root, "roastery", "roastery.json"),
    `${JSON.stringify(
      {
        repository: "https://github.com/fixture-owner/fixture-roastery",
        contract: {
          repository: "https://github.com/openboa-ai/coffee-chat-roastery",
          commit: "1".repeat(40),
          digest: contractDigest,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "roastery", "CONTENT_LICENSE.md"),
    renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Fixture Owner",
    }),
  );
  writeFileSync(
    join(root, "roastery", "index.json"),
    `${JSON.stringify({ beans: [] }, null, 2)}\n`,
  );
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", root]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture Owner"]);
  execFileSync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "fixture@example.invalid",
  ]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "base"]);
  const baseSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const beanPath = `roastery/beans/${beanId}.md`;
  const beanBytes = `---\nid: ${beanId}\n---\nOwner-approved Bean.\n`;
  writeFileSync(join(root, beanPath), beanBytes);
  const { projectIndexBytes } = await import("../src/projection/index.js");
  const indexBytes = await projectIndexBytes(root);
  writeFileSync(join(root, "roastery", "index.json"), indexBytes);
  execFileSync("git", ["-C", root, "add", beanPath, "roastery/index.json"]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "bean"]);
  const headSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return {
    root,
    eventPath: join(root, "event.json"),
    baseSha,
    headSha,
    beanPath,
    beanBytes,
    indexBytes,
    contractDigest,
  };
}

function runPublicationCheck(fixture: PublicationFixture, body: string) {
  writeFileSync(
    fixture.eventPath,
    `${JSON.stringify({
      pull_request: {
        base: { sha: fixture.baseSha },
        head: { sha: fixture.headSha },
        body,
      },
    })}\n`,
  );
  return spawnSync(process.execPath, [publicationCheckPath], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: fixture.eventPath,
      GITHUB_WORKSPACE: fixture.root,
      ROASTERY_TRUSTED_CONTRACT_REPOSITORY:
        "https://github.com/openboa-ai/coffee-chat-roastery",
      ROASTERY_TRUSTED_CONTRACT_COMMIT: "1".repeat(40),
      ROASTERY_TRUSTED_CONTRACT_DIGEST: fixture.contractDigest,
    },
  });
}

function gitHead(): string {
  const root = mkdtempSync(join(tmpdir(), "roastery-publication-git-"));
  temporaryRoots.push(root);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", root]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture Owner"]);
  execFileSync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "fixture@example.invalid",
  ]);
  execFileSync("git", [
    "-C",
    root,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Publication Contract", () => {
  test("enforces real PR bytes and attestation instead of only exercising fixtures", async () => {
    const fixture = await publicationFixture();

    const missing = runPublicationCheck(fixture, "");
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).toContain('"reason":"attestation_required"');

    const beanDigest = `sha256:${createHash("sha256")
      .update(fixture.beanBytes)
      .digest("hex")}`;
    const changeSetDigest = framedChangeSetDigest([
      { path: fixture.beanPath, bytes: fixture.beanBytes },
      { path: "roastery/index.json", bytes: fixture.indexBytes },
    ]);
    const body = `<!-- coffee-chat-publication\n${JSON.stringify({
      schema: "coffee-chat/bean-publication-attestation",
      head_sha: fixture.headSha,
      bean_path: fixture.beanPath,
      bean_digest: beanDigest,
      change_set_digest: changeSetDigest,
      attestation:
        "I attest that this Bean contains no embedded third-party material requiring attribution or prior-modification notices beyond the current Standard Roastery declaration and citation contract; Origin URLs and the resources they identify are references outside this Bean license.",
      accepted: true,
      embedded_third_party_notices_required: false,
    })}\n-->`;
    const accepted = runPublicationCheck(fixture, body);

    expect(accepted.status, accepted.stderr).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({
      status: "accepted",
      head_sha: fixture.headSha,
      bean_path: fixture.beanPath,
      bean_digest: beanDigest,
      change_set_digest: changeSetDigest,
    });
  });

  test("binds the exact owner attestation to one Bean, change set, and head", async () => {
    const headSha = gitHead();
    const beanBytes = Buffer.from("owner-approved Bean\n");
    const beanDigest = `sha256:${createHash("sha256").update(beanBytes).digest("hex")}`;
    const changeSetDigest = `sha256:${"2".repeat(64)}`;
    const { OWNER_PUBLICATION_ATTESTATION, validateBeanPublication } =
      await import("../src/validation/repository.js");

    expect(
      validateBeanPublication({
        headSha,
        changedPaths: [
          "roastery/index.json",
          "roastery/beans/01890f3a-2b00-7000-8000-000000000001.md",
        ],
        beanPath: "roastery/beans/01890f3a-2b00-7000-8000-000000000001.md",
        beanDigest,
        attestedBeanDigest: beanDigest,
        changeSetDigest,
        attestedChangeSetDigest: changeSetDigest,
        attestedHeadSha: headSha,
        attestation: OWNER_PUBLICATION_ATTESTATION,
        accepted: true,
        embeddedThirdPartyNoticesRequired: false,
      }),
    ).toEqual({ status: "accepted" });
  });

  test("rejects unrepresentable third-party notices or a stale attestation binding", async () => {
    const headSha = gitHead();
    const digest = `sha256:${"1".repeat(64)}`;
    const { OWNER_PUBLICATION_ATTESTATION, validateBeanPublication } =
      await import("../src/validation/repository.js");
    const base = {
      headSha,
      changedPaths: [
        "roastery/index.json",
        "roastery/beans/01890f3a-2b00-7000-8000-000000000001.md",
      ],
      beanPath: "roastery/beans/01890f3a-2b00-7000-8000-000000000001.md",
      beanDigest: digest,
      attestedBeanDigest: digest,
      changeSetDigest: digest,
      attestedChangeSetDigest: digest,
      attestedHeadSha: headSha,
      attestation: OWNER_PUBLICATION_ATTESTATION,
      accepted: true,
      embeddedThirdPartyNoticesRequired: false,
    };

    expect(
      validateBeanPublication({
        ...base,
        embeddedThirdPartyNoticesRequired: true,
      }),
    ).toEqual({
      status: "rejected",
      reason: "unrepresentable_third_party_notice",
    });
    expect(
      validateBeanPublication({ ...base, attestedHeadSha: "0".repeat(40) }),
    ).toEqual({ status: "rejected", reason: "attestation_binding_mismatch" });
  });

  test("allows only an exact-head owner-reviewed attribution correction that preserves prior grants", async () => {
    const headSha = gitHead();
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");
    const { validateAttributionCorrection } =
      await import("../src/validation/repository.js");
    const beforeBytes = renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Owner One",
    });
    const afterBytes = renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Owner Two",
    });
    const reviews = fakeGithubReviews([
      { reviewer: "fixture-owner", headSha, state: "approved" },
    ]);

    expect(
      validateAttributionCorrection({
        owner: "fixture-owner",
        headSha,
        changedPaths: ["roastery/CONTENT_LICENSE.md"],
        reviews,
        beforeBytes,
        afterBytes,
        priorGrantReceiptDigestsBefore: [`sha256:${"3".repeat(64)}`],
        priorGrantReceiptDigestsAfter: [`sha256:${"3".repeat(64)}`],
      }),
    ).toEqual({
      status: "accepted",
      beforeAttribution: "Owner One",
      afterAttribution: "Owner Two",
    });
  });

  test.each([
    { name: "missing owner review", reviews: [] },
    {
      name: "wrong owner review",
      reviews: [
        {
          reviewer: "other-owner",
          headSha: "HEAD",
          state: "approved" as const,
        },
      ],
    },
    {
      name: "stale head review",
      reviews: [
        {
          reviewer: "fixture-owner",
          headSha: "0".repeat(40),
          state: "approved" as const,
        },
      ],
    },
  ])("rejects attribution correction with $name", async ({ reviews }) => {
    const headSha = gitHead();
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");
    const { validateAttributionCorrection } =
      await import("../src/validation/repository.js");
    const normalizedReviews = fakeGithubReviews(
      reviews.map((review) => ({
        ...review,
        headSha: review.headSha === "HEAD" ? headSha : review.headSha,
      })),
    );
    const beforeBytes = renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Owner One",
    });
    const afterBytes = renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Owner Two",
    });

    expect(
      validateAttributionCorrection({
        owner: "fixture-owner",
        headSha,
        changedPaths: ["roastery/CONTENT_LICENSE.md"],
        reviews: normalizedReviews,
        beforeBytes,
        afterBytes,
        priorGrantReceiptDigestsBefore: [`sha256:${"3".repeat(64)}`],
        priorGrantReceiptDigestsAfter: [`sha256:${"3".repeat(64)}`],
      }),
    ).toMatchObject({ status: "rejected", reason: "owner_review_required" });
  });

  test("rejects scope or license changes and revocation of an earlier receipt", async () => {
    const headSha = gitHead();
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");
    const { validateAttributionCorrection } =
      await import("../src/validation/repository.js");
    const beforeBytes = renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Owner One",
    });
    const afterBytes = renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Owner Two",
    });
    const reviews = fakeGithubReviews([
      { reviewer: "fixture-owner", headSha, state: "approved" },
    ]);

    expect(
      validateAttributionCorrection({
        owner: "fixture-owner",
        headSha,
        changedPaths: ["roastery/CONTENT_LICENSE.md"],
        reviews,
        beforeBytes,
        afterBytes: afterBytes.replace(
          "license: CC-BY-4.0",
          "license: CC0-1.0",
        ),
        priorGrantReceiptDigestsBefore: [],
        priorGrantReceiptDigestsAfter: [],
      }),
    ).toMatchObject({ status: "rejected", reason: "scope_or_license_change" });
    expect(
      validateAttributionCorrection({
        owner: "fixture-owner",
        headSha,
        changedPaths: ["roastery/CONTENT_LICENSE.md"],
        reviews,
        beforeBytes,
        afterBytes,
        priorGrantReceiptDigestsBefore: [`sha256:${"3".repeat(64)}`],
        priorGrantReceiptDigestsAfter: [],
      }),
    ).toMatchObject({ status: "rejected", reason: "prior_grant_revoked" });
  });
});
