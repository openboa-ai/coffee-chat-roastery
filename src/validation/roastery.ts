import {
  CONTRACT_REPOSITORY,
  type ContractPin,
  type RoasteryManifest,
} from "../contract/types.ts";

const REPOSITORY =
  /^https:\/\/github\.com\/[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9][a-z0-9._-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export type RoasteryManifestValidationResult =
  | { status: "valid"; manifest: RoasteryManifest }
  | { status: "invalid"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort())
  );
}

export function validateRoasteryManifest(
  value: unknown,
  expectedContract?: ContractPin,
): RoasteryManifestValidationResult {
  if (!isRecord(value) || !sameKeys(value, ["repository", "contract"])) {
    return { status: "invalid", reason: "invalid_roastery_manifest" };
  }
  if (
    typeof value.repository !== "string" ||
    !REPOSITORY.test(value.repository)
  ) {
    return { status: "invalid", reason: "invalid_repository" };
  }
  if (
    !isRecord(value.contract) ||
    !sameKeys(value.contract, ["repository", "commit", "digest"])
  ) {
    return { status: "invalid", reason: "invalid_contract_pin" };
  }
  const contract = value.contract;
  if (
    contract.repository !== CONTRACT_REPOSITORY ||
    typeof contract.commit !== "string" ||
    !COMMIT.test(contract.commit) ||
    typeof contract.digest !== "string" ||
    !DIGEST.test(contract.digest)
  ) {
    return { status: "invalid", reason: "invalid_contract_pin" };
  }
  const manifest = value as unknown as RoasteryManifest;
  if (
    expectedContract !== undefined &&
    (manifest.contract.repository !== expectedContract.repository ||
      manifest.contract.commit !== expectedContract.commit ||
      manifest.contract.digest !== expectedContract.digest)
  ) {
    return { status: "invalid", reason: "contract_mismatch" };
  }
  return { status: "valid", manifest };
}
