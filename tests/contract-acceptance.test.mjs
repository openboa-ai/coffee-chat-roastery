import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
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
const MAX_CONTENT_LICENSE_CHARACTERS = 8 * 1024;
const MAX_CONTRACT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONTRACT_BUNDLE_BYTES = 8 * 1024 * 1024;

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

  const emoji = renderContentLicense("Coffee Owner ☕");
  assert.deepEqual(parseContentLicense(emoji.content), emoji);

  for (const { attribution, markdownText } of [
    {
      attribution: "[Owner](https://attacker.example)",
      markdownText: "\\[Owner\\]\\(https\\:\\/\\/attacker\\.example\\)",
    },
    {
      attribution: "![Owner](https://attacker.example/image)",
      markdownText:
        "\\!\\[Owner\\]\\(https\\:\\/\\/attacker\\.example\\/image\\)",
    },
    { attribution: "**Owner**", markdownText: "\\*\\*Owner\\*\\*" },
    { attribution: "`Owner`", markdownText: "\\`Owner\\`" },
  ]) {
    const plainText = renderContentLicense(attribution);
    const attributionLine =
      plainText.content
        .split("\n")
        .find((line) => line.startsWith("Attribution: ")) ?? "";
    assert.equal(attributionLine, `Attribution: ${markdownText}`);
    assert.deepEqual(parseContentLicense(plainText.content), plainText);
  }

  for (const attribution of [
    "",
    " owner",
    "owner ",
    "owner\nname",
    "Owner <!--",
    "Owner <script>",
    "owner\ud800",
    "owner\udc00",
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
  assert.throws(
    () => parseContentLicense("\n".repeat(MAX_CONTENT_LICENSE_CHARACTERS + 1)),
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
  const raced = mkdtempSync(join(tmpdir(), "roastery-contract-race-"));
  const directoryRace = mkdtempSync(
    join(tmpdir(), "roastery-contract-directory-race-"),
  );
  const malformedNames = mkdtempSync(
    join(tmpdir(), "roastery-contract-malformed-name-"),
  );
  const external = mkdtempSync(join(tmpdir(), "roastery-contract-external-"));
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

    cpSync(contractRoot, join(raced, "contract"), { recursive: true });
    const racedEntry = join(raced, "contract", "security.md");
    const externalEntry = join(external, "outside.md");
    writeFileSync(externalEntry, "outside contract bytes\n");
    const originalLstat = fs.lstatSync;
    let swapped = false;
    Object.defineProperty(fs, "lstatSync", {
      configurable: true,
      value: function lstatAndSwap(path, options) {
        const stat = originalLstat.call(fs, path, options);
        if (!swapped && String(path) === racedEntry) {
          swapped = true;
          fs.unlinkSync(racedEntry);
          fs.symlinkSync(externalEntry, racedEntry);
        }
        return stat;
      },
    });
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => computeContractDigest(raced),
        /unsafe_contract_entry/u,
      );
    } finally {
      Object.defineProperty(fs, "lstatSync", {
        configurable: true,
        value: originalLstat,
      });
      syncBuiltinESMExports();
    }

    cpSync(contractRoot, join(directoryRace, "contract"), {
      recursive: true,
    });
    const schemas = join(directoryRace, "contract", "schemas");
    const movedSchemas = join(directoryRace, "contract", "schemas-original");
    const externalSchemas = join(external, "schemas");
    fs.mkdirSync(externalSchemas);
    writeFileSync(join(externalSchemas, "outside.json"), "{}\n");
    let directorySwapped = false;
    Object.defineProperty(fs, "lstatSync", {
      configurable: true,
      value: function lstatAndSwapDirectory(path, options) {
        const stat = originalLstat.call(fs, path, options);
        if (!directorySwapped && String(path) === schemas) {
          directorySwapped = true;
          fs.renameSync(schemas, movedSchemas);
          fs.symlinkSync(externalSchemas, schemas);
        }
        return stat;
      },
    });
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => computeContractDigest(directoryRace),
        /unsafe_contract_entry/u,
      );
    } finally {
      Object.defineProperty(fs, "lstatSync", {
        configurable: true,
        value: originalLstat,
      });
      syncBuiltinESMExports();
    }

    const malformedContract = join(malformedNames, "contract");
    cpSync(contractRoot, malformedContract, { recursive: true });
    writeFileSync(join(malformedContract, "�"), "non-portable name\n");
    assert.equal(computeContractDigest(malformedNames), expected);
    rmSync(join(malformedContract, "�"));
    writeFileSync(join(malformedContract, "CON"), "reserved name\n");
    assert.equal(computeContractDigest(malformedNames), expected);
  } finally {
    syncBuiltinESMExports();
    rmSync(sandbox, { force: true, recursive: true });
    rmSync(linked, { force: true, recursive: true });
    rmSync(raced, { force: true, recursive: true });
    rmSync(directoryRace, { force: true, recursive: true });
    rmSync(malformedNames, { force: true, recursive: true });
    rmSync(external, { force: true, recursive: true });
  }
});

test("contract digest rejects oversized files and aggregate bundles before unbounded reads", () => {
  const contractRoot = join(repositoryRoot, "contract");
  const perFile = mkdtempSync(join(tmpdir(), "roastery-contract-byte-limit-"));
  const aggregate = mkdtempSync(
    join(tmpdir(), "roastery-contract-aggregate-limit-"),
  );
  try {
    cpSync(contractRoot, join(perFile, "contract"), { recursive: true });
    const security = join(perFile, "contract", "security.md");
    writeFileSync(security, Buffer.alloc(MAX_CONTRACT_FILE_BYTES, 0x61));
    assert.doesNotThrow(() => computeContractDigest(perFile));
    writeFileSync(security, Buffer.alloc(MAX_CONTRACT_FILE_BYTES + 1, 0x61));
    assert.throws(
      () => computeContractDigest(perFile),
      /unsafe_contract_entry/u,
    );

    cpSync(contractRoot, join(aggregate, "contract"), { recursive: true });
    const exactLimitPaths = [
      "README.md",
      "contract.json",
      "publication.md",
      "security.md",
    ];
    for (const relativePath of exactLimitPaths) {
      writeFileSync(
        join(aggregate, "contract", relativePath),
        Buffer.alloc(MAX_CONTRACT_BUNDLE_BYTES / exactLimitPaths.length, 0x62),
      );
    }
    for (const relativePath of [
      "schemas/bean-frontmatter.schema.json",
      "schemas/content-license.schema.json",
      "schemas/index.schema.json",
      "schemas/roastery.schema.json",
      "templates/content-license.md",
    ]) {
      writeFileSync(join(aggregate, "contract", relativePath), Buffer.alloc(0));
    }
    assert.doesNotThrow(() => computeContractDigest(aggregate));
    writeFileSync(
      join(aggregate, "contract", "templates/content-license.md"),
      Buffer.from("x"),
    );
    assert.throws(
      () => computeContractDigest(aggregate),
      /unsafe_contract_entry/u,
    );
  } finally {
    rmSync(perFile, { force: true, recursive: true });
    rmSync(aggregate, { force: true, recursive: true });
  }
});
