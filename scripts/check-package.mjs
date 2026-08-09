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
  for (const path of ["dist/cli.js", "dist/index.js", "LICENSE", "README.md"]) {
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
  for (const command of ["validate", "project-index", "contract-digest"]) {
    const result = spawnSync(executable, [command], {
      cwd: consumerRoot,
      encoding: "utf8",
    });
    if (
      result.status !== 1 ||
      JSON.stringify(JSON.parse(result.stdout)) !==
        JSON.stringify({ command, status: "not_implemented" })
    ) {
      throw new Error(`installed_cli_invalid:${command}`);
    }
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
  if (
    JSON.stringify(api) !==
    JSON.stringify(["contractDigest", "projectIndex", "validate"])
  ) {
    throw new Error("installed_api_invalid");
  }
} finally {
  rmSync(packageSandbox, { force: true, recursive: true });
}

process.stdout.write('{"status":"valid","package":"shell"}\n');
