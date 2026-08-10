#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync(process.execPath, [resolve(root, "scripts/build.mjs")], {
  cwd: root,
  stdio: "inherit",
});
const packageSandbox = mkdtempSync(join(tmpdir(), "roastery-package-check-"));
try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        packageSandbox,
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  const packedPaths = new Set(packed[0]?.files?.map((entry) => entry.path));
  const contractPaths = [
    "contract/README.md",
    "contract/contract.json",
    "contract/publication.md",
    "contract/schemas/bean-frontmatter.schema.json",
    "contract/schemas/content-license.schema.json",
    "contract/schemas/index.schema.json",
    "contract/schemas/roastery.schema.json",
    "contract/security.md",
    "contract/templates/content-license.md",
  ].sort();
  const packedContractPaths = [...packedPaths]
    .filter((path) => path.startsWith("contract/"))
    .sort();
  if (JSON.stringify(packedContractPaths) !== JSON.stringify(contractPaths)) {
    throw new Error("packaged_contract_layout_invalid");
  }
  for (const path of [
    "contract/contract.json",
    "contract/publication.md",
    "contract/security.md",
    "dist/cli.js",
    "dist/index.js",
    "LICENSE",
    "README.md",
  ]) {
    if (!packedPaths.has(path))
      throw new Error(`unpackaged_shell_file:${path}`);
  }

  const archiveName = packed[0]?.filename;
  if (typeof archiveName !== "string")
    throw new Error("package_archive_missing");
  const consumerRoot = resolve(packageSandbox, "consumer");
  mkdirSync(consumerRoot);
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--offline",
      "--no-audit",
      "--no-fund",
      resolve(packageSandbox, archiveName),
    ],
    {
      cwd: consumerRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const executable = resolve(consumerRoot, "node_modules/.bin/roastery");
  const digest = spawnSync(
    executable,
    [
      "contract-digest",
      "--root",
      resolve(consumerRoot, "node_modules/@openboa-ai/coffee-chat-roastery"),
      "--format",
      "json",
    ],
    {
      cwd: consumerRoot,
      encoding: "utf8",
    },
  );
  if (digest.status !== 0 || JSON.parse(digest.stdout).status !== "valid") {
    throw new Error("installed_cli_invalid:contract-digest");
  }
  const api = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const api = await import("@openboa-ai/coffee-chat-roastery"); console.log(JSON.stringify(Object.keys(api).sort()));',
      ],
      {
        cwd: consumerRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  for (const required of [
    "ContentLicenseError",
    "computeContractDigest",
    "parseContentLicense",
    "projectIndex",
    "renderContentLicense",
    "validate",
  ]) {
    if (!api.includes(required))
      throw new Error(`installed_api_missing:${required}`);
  }
  if (api.includes("contractDigest")) {
    throw new Error("installed_api_invalid");
  }
} finally {
  rmSync(packageSandbox, { force: true, recursive: true });
}

process.stdout.write('{"status":"valid","package":"contract"}\n');
