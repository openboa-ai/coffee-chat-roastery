import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import test from "node:test";

import {
  ContentLicenseError,
  computeContractDigest,
  parseContentLicense,
  renderContentLicense,
} from "../dist/index.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;

function regularFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    if (entry.isDirectory()) return regularFiles(root, path);
    if (!entry.isFile()) throw new Error(`unexpected_contract_entry:${path}`);
    return [
      {
        path,
        relativePath: relative(root, path).split(sep).join("/"),
      },
    ];
  });
}

function independentDigest(contractRoot) {
  const hash = createHash("sha256");
  for (const entry of regularFiles(contractRoot).sort((left, right) =>
    Buffer.from(left.relativePath).compare(Buffer.from(right.relativePath)),
  )) {
    const path = Buffer.from(entry.relativePath, "utf8");
    const content = readFileSync(entry.path);
    const pathLength = Buffer.alloc(8);
    const contentLength = Buffer.alloc(8);
    pathLength.writeBigUInt64BE(BigInt(path.length));
    contentLength.writeBigUInt64BE(BigInt(content.length));
    hash.update(pathLength);
    hash.update(path);
    hash.update(contentLength);
    hash.update(content);
  }
  return `sha256:${hash.digest("hex")}`;
}

test("the immutable bundle renders one fixed, round-trippable Bean license", () => {
  const rendered = renderContentLicense("Cafe\u0301 Owner");

  assert.equal(rendered.attribution, "Café Owner");
  assert.equal(rendered.scope, "roastery/beans/**");
  assert.equal(rendered.license, "CC-BY-4.0");
  assert.match(rendered.content, /^---\nscope: roastery\/beans\/\*\*\n/u);
  assert.match(
    rendered.content,
    /https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//u,
  );
  assert.equal(
    rendered.digest,
    `sha256:${createHash("sha256").update(rendered.content).digest("hex")}`,
  );
  assert.deepEqual(parseContentLicense(rendered.content), rendered);

  for (const attribution of [
    "",
    " owner",
    "owner ",
    "owner\nname",
    "<OWNER_PROVIDED_ATTRIBUTION>",
    "x".repeat(121),
  ]) {
    assert.throws(
      () => renderContentLicense(attribution),
      (error) =>
        error instanceof ContentLicenseError &&
        error.code === "invalid_content_license",
      attribution,
    );
  }

  const unsupported = rendered.content.replace("CC-BY-4.0", "CC0-1.0");
  assert.throws(
    () => parseContentLicense(unsupported),
    (error) =>
      error instanceof ContentLicenseError &&
      error.code === "unsupported_content_license",
  );
  assert.throws(
    () => parseContentLicense(`${rendered.content}unknown: value\n`),
    (error) =>
      error instanceof ContentLicenseError &&
      error.code === "invalid_content_license",
  );
});

test("the contract digest is reproducible, framed, and sensitive to exact bytes", () => {
  const contractRoot = join(repositoryRoot, "contract");
  const expected = independentDigest(contractRoot);
  assert.equal(computeContractDigest(repositoryRoot), expected);

  const sandbox = mkdtempSync(join(tmpdir(), "roastery-contract-"));
  const linked = mkdtempSync(join(tmpdir(), "roastery-contract-link-"));
  try {
    cpSync(contractRoot, join(sandbox, "contract"), { recursive: true });
    assert.equal(computeContractDigest(sandbox), expected);
    writeFileSync(
      join(sandbox, "contract", "security.md"),
      `${readFileSync(join(contractRoot, "security.md"), "utf8")}\n`,
    );
    assert.notEqual(computeContractDigest(sandbox), expected);

    symlinkSync(contractRoot, join(linked, "contract"));
    assert.throws(
      () => computeContractDigest(linked),
      /unsafe_contract_entry/u,
    );
  } finally {
    rmSync(sandbox, { force: true, recursive: true });
    rmSync(linked, { force: true, recursive: true });
  }
});
