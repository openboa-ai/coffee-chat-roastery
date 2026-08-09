#!/usr/bin/env node

import {
  contractDigest,
  projectIndex,
  validate,
  type NotImplementedResult,
} from "./index.js";

const commands: Record<string, () => NotImplementedResult> = {
  "contract-digest": contractDigest,
  "project-index": projectIndex,
  validate,
};

const command = process.argv[2];
const handler = command ? commands[command] : undefined;

if (!handler) {
  process.stderr.write(
    "unknown command; use validate, project-index, or contract-digest\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(handler())}\n`);
  process.exitCode = 1;
}
