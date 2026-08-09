#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync(process.execPath, [resolve(root, "scripts/build.mjs")], {
  cwd: root,
  stdio: "inherit",
});
const contract = JSON.parse(
  readFileSync(resolve(root, "contract/contract.json"), "utf8"),
);
const inventory = [
  "contract/contract.json",
  ...Object.values(contract.files),
].sort();

const tracked = new Set(
  execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean),
);
for (const path of inventory) {
  if (!tracked.has(path)) throw new Error(`untracked_bundle_file:${path}`);
}
execFileSync("git", ["-C", root, "diff", "--exit-code", "--", "dist"], {
  stdio: ["ignore", "ignore", "pipe"],
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
  for (const path of inventory) {
    if (!packedPaths.has(path))
      throw new Error(`unpackaged_bundle_file:${path}`);
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
  const result = JSON.parse(
    execFileSync(
      executable,
      ["contract-digest", "--root", root, "--format", "json"],
      {
        cwd: consumerRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  if (
    result.status !== "valid" ||
    !/^sha256:[0-9a-f]{64}$/u.test(result.digest)
  ) {
    throw new Error("installed_cli_invalid");
  }
  const api = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'const api = await import("@openboa-ai/coffee-chat-roastery"); console.log(JSON.stringify({ digest: typeof api.digestContractBundle, validate: typeof api.validateRepository }));',
      ],
      {
        cwd: consumerRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  if (api.digest !== "function" || api.validate !== "function") {
    throw new Error("installed_api_invalid");
  }
} finally {
  rmSync(packageSandbox, { force: true, recursive: true });
}

const inventorySet = new Set(inventory);
for (const path of inventory.filter((entry) => /\.(?:js|ts)$/u.test(entry))) {
  const source = readFileSync(resolve(root, path), "utf8");
  for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/gu)) {
    const specifier = match[1];
    if (specifier === undefined) {
      throw new Error(`invalid_bundle_import:${path}`);
    }
    const imported = posix.normalize(
      posix.join(posix.dirname(path), specifier),
    );
    if (/\.(?:js|ts)$/u.test(imported) && !inventorySet.has(imported)) {
      throw new Error(`bundle_import_outside_inventory:${path}:${imported}`);
    }
  }
}

process.stdout.write(
  `${JSON.stringify({ status: "valid", bundle_file_count: inventory.length })}\n`,
);
