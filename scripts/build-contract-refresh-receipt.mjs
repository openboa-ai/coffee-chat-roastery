import { readFileSync, writeFileSync } from "node:fs";
import { TextDecoder } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";

import { buildContractRefreshReceiptEnvelope } from "../src/validation/repository.ts";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizeUploadArtifactDigest(value) {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error("upload-artifact digest is invalid");
  }
  return `sha256:${value}`;
}

const evidencePath = requiredEnvironment("CONTRACT_REFRESH_EVIDENCE_PATH");
const evidenceBytes = readFileSync(evidencePath);
const evidenceSource = new TextDecoder("utf-8", { fatal: true }).decode(
  evidenceBytes,
);
const evidence = JSON.parse(evidenceSource);
const ajv = new Ajv2020.default({ allErrors: true, strict: true });
const evidenceSchema = JSON.parse(
  readFileSync(
    "contract/schemas/contract-refresh-evidence.schema.json",
    "utf8",
  ),
);
const receiptSchema = JSON.parse(
  readFileSync("contract/schemas/contract-refresh-receipt.schema.json", "utf8"),
);
const validateEvidence = ajv.compile(evidenceSchema);
if (!validateEvidence(evidence)) {
  throw new Error(
    `contract-refresh evidence is invalid: ${JSON.stringify(validateEvidence.errors)}`,
  );
}

const receipt = buildContractRefreshReceiptEnvelope({
  evidenceBytes,
  evidenceArtifact: {
    id: requiredEnvironment("CONTRACT_REFRESH_EVIDENCE_ARTIFACT_ID"),
    digest: normalizeUploadArtifactDigest(
      requiredEnvironment("CONTRACT_REFRESH_EVIDENCE_ARTIFACT_DIGEST"),
    ),
    url: requiredEnvironment("CONTRACT_REFRESH_EVIDENCE_ARTIFACT_URL"),
  },
  runUrl: requiredEnvironment("GITHUB_RUN_URL"),
});
const validateReceipt = ajv.compile(receiptSchema);
if (!validateReceipt(receipt)) {
  throw new Error(
    `contract-refresh receipt is invalid: ${JSON.stringify(validateReceipt.errors)}`,
  );
}
writeFileSync(
  requiredEnvironment("CONTRACT_REFRESH_RECEIPT_OUTPUT"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
