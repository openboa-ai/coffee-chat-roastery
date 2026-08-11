#!/usr/bin/env node
import { resolve } from "node:path";

import { validate } from "../dist/index.js";

const officialRepository = "https://github.com/openboa-ai/coffee-chat-roastery";
const contract = Object.freeze({
  repository: officialRepository,
  commit: "d7d770af59a691b5ebceee9809ab436f32db33d5",
  digest:
    "sha256:878704aa835d167ea6ef6979f7cd0258cf02476b3f7c16926779f4f18ce75428",
});

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function expectedRepository() {
  const explicit = value("--expected-repository");
  if (explicit) return explicit;
  if (process.env.GITHUB_REPOSITORY) {
    return `https://github.com/${process.env.GITHUB_REPOSITORY}`;
  }
  return officialRepository;
}

function output(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "valid" ? 0 : 1;
}

const result = validate({
  root: resolve(value("--root") ?? "."),
  expectedContract: contract,
});

if (result.status === "valid" && result.repository !== expectedRepository()) {
  output({ code: "identity_mismatch", status: "invalid" });
} else {
  output(result);
}
