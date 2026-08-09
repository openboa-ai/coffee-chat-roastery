#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");

rmSync(output, { force: true, recursive: true });
execFileSync(
  process.execPath,
  [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "-p",
    "tsconfig.build.json",
  ],
  { cwd: root, stdio: "inherit" },
);
chmodSync(resolve(output, "cli.js"), 0o755);
