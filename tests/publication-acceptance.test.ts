import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { fakeGithubReviews } from "./helpers/fake-github-review-boundary.js";

const temporaryRoots: string[] = [];

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
