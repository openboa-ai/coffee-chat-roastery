import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { TextDecoder } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";

import {
  CONTENT_LICENSE_IDENTIFIER,
  CONTENT_LICENSE_SCOPE,
  CONTENT_LICENSE_URL,
  CONTRACT_REPOSITORY,
  type ContentLicensePolicy,
} from "../contract/types.ts";
import {
  digestRightsSemantics,
  serializeRightsSemantics,
  type RightsSemanticsProjection,
} from "../projection/rights-semantics.ts";
import { requireNoFollowPath } from "./filesystem.ts";

const CONTRACT_FILE_KEYS = [
  "roastery_schema",
  "index_schema",
  "bean_frontmatter_schema",
  "content_license_schema",
  "rights_semantics_schema",
  "contract_refresh_evidence_schema",
  "contract_refresh_receipt_schema",
  "content_license_template",
  "publication_contract",
  "security_contract",
] as const;
const SCHEMA_KEYS = CONTRACT_FILE_KEYS.filter((key) => key.endsWith("_schema"));
const PLACEHOLDER = "<OWNER_PROVIDED_ATTRIBUTION>";
const INVALID_ATTRIBUTION_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

type ContractFileKey = (typeof CONTRACT_FILE_KEYS)[number];

interface ContractDocument {
  repository: string;
  digest: Record<string, unknown>;
  content_license: ContentLicensePolicy;
  files: Record<ContractFileKey, string>;
}

export interface InterpretedContractBundle {
  policy: ContentLicensePolicy;
  projection: RightsSemanticsProjection;
  projectionBytes: string;
  projectionDigest: `sha256:${string}`;
  validation: "passed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function parsePolicy(value: unknown): ContentLicensePolicy | null {
  const keys = [
    "scope",
    "spdx_identifier",
    "official_license_url",
    "attribution_normalization",
    "supported",
    "attribution_required",
    "change_indication_required",
    "product_provenance_required",
  ] as const;
  if (
    !isRecord(value) ||
    !sameKeys(value, keys) ||
    typeof value.scope !== "string" ||
    typeof value.spdx_identifier !== "string" ||
    typeof value.official_license_url !== "string" ||
    (value.attribution_normalization !== "NFC" &&
      value.attribution_normalization !== "NFD") ||
    typeof value.supported !== "boolean" ||
    typeof value.attribution_required !== "boolean" ||
    typeof value.change_indication_required !== "boolean" ||
    typeof value.product_provenance_required !== "boolean"
  ) {
    return null;
  }
  return value as unknown as ContentLicensePolicy;
}

async function collectContractPaths(
  contractRoot: string,
  directory = contractRoot,
): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) throw new Error("bundle_validation_failed");
    if (metadata.isDirectory()) {
      paths.push(...(await collectContractPaths(contractRoot, absolutePath)));
    } else if (metadata.isFile()) {
      paths.push(
        `contract/${relative(contractRoot, absolutePath).split(sep).join("/")}`,
      );
    } else {
      throw new Error("bundle_validation_failed");
    }
  }
  return paths.sort();
}

function parseContractDocument(value: unknown): ContractDocument {
  if (
    !isRecord(value) ||
    !sameKeys(value, ["repository", "digest", "content_license", "files"]) ||
    value.repository !== CONTRACT_REPOSITORY ||
    !isRecord(value.digest) ||
    !sameKeys(value.digest, [
      "algorithm",
      "file_count_bytes",
      "path_length_bytes",
      "content_length_bytes",
      "byte_order",
      "path_base",
      "path_order",
    ]) ||
    JSON.stringify(value.digest) !==
      JSON.stringify({
        algorithm: "sha256",
        file_count_bytes: 4,
        path_length_bytes: 4,
        content_length_bytes: 8,
        byte_order: "big-endian",
        path_base: "contract/",
        path_order: "utf8-bytewise",
      }) ||
    !isRecord(value.files) ||
    !sameKeys(value.files, CONTRACT_FILE_KEYS)
  ) {
    throw new Error("bundle_validation_failed");
  }
  const policy = parsePolicy(value.content_license);
  if (policy === null) throw new Error("bundle_validation_failed");
  for (const key of CONTRACT_FILE_KEYS) {
    const path = value.files[key];
    if (
      typeof path !== "string" ||
      !path.startsWith("contract/") ||
      path.includes("..")
    ) {
      throw new Error("bundle_validation_failed");
    }
  }
  return {
    repository: value.repository,
    digest: value.digest,
    content_license: policy,
    files: value.files as Record<ContractFileKey, string>,
  };
}

function parseDeclaration(
  bytes: Uint8Array,
  decoder: TextDecoder,
): {
  source: string;
  frontmatter: Record<string, unknown>;
  attribution: string;
} {
  const source = decoder.decode(bytes);
  if (source.includes("\r") || !source.startsWith("---\n")) {
    throw new Error("bundle_validation_failed");
  }
  const boundary = source.indexOf("\n---\n", 4);
  if (boundary < 0) throw new Error("bundle_validation_failed");
  const lines = source.slice(4, boundary).split("\n");
  if (lines.length !== 3) throw new Error("bundle_validation_failed");
  const scope = /^scope: (\S+)$/u.exec(lines[0] ?? "")?.[1];
  const license = /^license: ([A-Za-z0-9.-]+)$/u.exec(lines[1] ?? "")?.[1];
  const attributionSource = /^attribution: (".*")$/u.exec(lines[2] ?? "")?.[1];
  if (
    scope === undefined ||
    license === undefined ||
    attributionSource === undefined
  ) {
    throw new Error("bundle_validation_failed");
  }
  let attribution: unknown;
  try {
    attribution = JSON.parse(attributionSource);
  } catch {
    throw new Error("bundle_validation_failed");
  }
  if (
    typeof attribution !== "string" ||
    attribution !== attribution.trim() ||
    attribution !== attribution.normalize("NFC") ||
    attribution.length === 0 ||
    [...attribution].length > 120 ||
    INVALID_ATTRIBUTION_CHARACTER.test(attribution) ||
    attribution === PLACEHOLDER
  ) {
    throw new Error("bundle_validation_failed");
  }
  return {
    source,
    frontmatter: { scope, license, attribution },
    attribution,
  };
}

function renderBundleTemplate(template: string, attribution: string): string {
  const quotedPlaceholder = JSON.stringify(PLACEHOLDER);
  if (
    template.split(quotedPlaceholder).length !== 2 ||
    template.split(PLACEHOLDER).length !== 3
  ) {
    throw new Error("bundle_validation_failed");
  }
  return template
    .replace(quotedPlaceholder, () => JSON.stringify(attribution))
    .replace(PLACEHOLDER, () => attribution);
}

export function isFixedInitialContentLicensePolicy(
  policy: ContentLicensePolicy,
): boolean {
  return (
    policy.scope === CONTENT_LICENSE_SCOPE &&
    policy.spdx_identifier === CONTENT_LICENSE_IDENTIFIER &&
    policy.official_license_url === CONTENT_LICENSE_URL &&
    policy.attribution_normalization === "NFC" &&
    policy.supported === true &&
    policy.attribution_required === true &&
    policy.change_indication_required === true &&
    policy.product_provenance_required === true
  );
}

export async function interpretContractBundle(
  root: string,
  declarationBytes: Uint8Array,
): Promise<InterpretedContractBundle> {
  await requireNoFollowPath(root, "contract", "directory");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const contractRoot = join(root, "contract");
  const contract = parseContractDocument(
    JSON.parse(
      decoder.decode(await readFile(join(contractRoot, "contract.json"))),
    ),
  );
  const actualPaths = await collectContractPaths(contractRoot);
  const declaredPaths = [
    "contract/contract.json",
    ...Object.values(contract.files),
  ].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) {
    throw new Error("bundle_validation_failed");
  }

  const ajv = new Ajv2020.default({ allErrors: true, strict: true });
  const validators = new Map<ContractFileKey, ReturnType<typeof ajv.compile>>();
  for (const key of SCHEMA_KEYS) {
    const schema = JSON.parse(
      decoder.decode(await readFile(join(root, contract.files[key]))),
    );
    validators.set(key, ajv.compile(schema));
  }

  const declaration = parseDeclaration(declarationBytes, decoder);
  const validateDeclaration = validators.get("content_license_schema");
  if (
    validateDeclaration === undefined ||
    !validateDeclaration(declaration.frontmatter)
  ) {
    throw new Error("bundle_validation_failed");
  }
  const template = decoder.decode(
    await readFile(join(root, contract.files.content_license_template)),
  );
  if (
    renderBundleTemplate(template, declaration.attribution) !==
    declaration.source
  ) {
    throw new Error("bundle_validation_failed");
  }
  for (const key of ["publication_contract", "security_contract"] as const) {
    if (
      decoder.decode(await readFile(join(root, contract.files[key]))).trim()
        .length === 0
    ) {
      throw new Error("bundle_validation_failed");
    }
  }

  const policy = contract.content_license;
  const projection: RightsSemanticsProjection = {
    scope: policy.scope,
    spdx_identifier: policy.spdx_identifier,
    official_license_url: policy.official_license_url,
    normalized_attribution: declaration.attribution.normalize(
      policy.attribution_normalization,
    ),
    status: policy.supported ? "supported" : "invalid",
    attribution_required: policy.attribution_required,
    change_indication_required: policy.change_indication_required,
    product_provenance_required: policy.product_provenance_required,
  };
  const validateProjection = validators.get("rights_semantics_schema");
  if (validateProjection === undefined || !validateProjection(projection)) {
    throw new Error("bundle_validation_failed");
  }
  const projectionBytes = serializeRightsSemantics(projection);
  return {
    policy,
    projection,
    projectionBytes,
    projectionDigest: digestRightsSemantics(projectionBytes),
    validation: "passed",
  };
}
