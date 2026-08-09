import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CONTENT_LICENSE_IDENTIFIER, CONTENT_LICENSE_SCOPE, CONTENT_LICENSE_URL, CONTRACT_REPOSITORY, } from "./types.js";
import { requireNoFollowPath } from "../validation/filesystem.js";
export const CONTRACT_FILE_KEYS = [
    "roastery_schema",
    "index_schema",
    "bean_frontmatter_schema",
    "content_license_schema",
    "content_license_template",
    "init_contract",
    "publication_contract",
    "security_contract",
    "public_cli",
    "contract_digest",
    "contract_manifest_parser",
    "contract_types",
    "public_api",
    "content_license_renderer",
    "index_projection",
    "bean_validator",
    "content_license_parser",
    "contract_bundle_validator",
    "filesystem_validator",
    "index_validator",
    "publication_validator",
    "repository_validator",
    "roastery_validator",
];
export const SCHEMA_FILE_KEYS = [
    "roastery_schema",
    "index_schema",
    "bean_frontmatter_schema",
    "content_license_schema",
];
export const CONTRACT_DIGEST_FRAMING = {
    algorithm: "sha256",
    file_count_bytes: 4,
    path_length_bytes: 4,
    content_length_bytes: 8,
    byte_order: "big-endian",
    path_base: "repository",
    path_order: "utf8-bytewise",
};
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
    return (JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()));
}
function parsePolicy(value) {
    const keys = [
        "scope",
        "spdx_identifier",
        "official_license_url",
        "attribution_normalization",
        "supported",
        "attribution_required",
        "change_indication_required",
        "product_provenance_required",
    ];
    if (!isRecord(value) ||
        !hasExactKeys(value, keys) ||
        value.scope !== CONTENT_LICENSE_SCOPE ||
        value.spdx_identifier !== CONTENT_LICENSE_IDENTIFIER ||
        value.official_license_url !== CONTENT_LICENSE_URL ||
        value.attribution_normalization !== "NFC" ||
        value.supported !== true ||
        value.attribution_required !== true ||
        value.change_indication_required !== true ||
        value.product_provenance_required !== true) {
        return null;
    }
    return value;
}
function isCanonicalBundlePath(value) {
    if (typeof value !== "string" ||
        !/^(?:contract|dist)\/[a-z0-9][a-z0-9./-]*\.(?:json|md|js)$/u.test(value) ||
        value.includes("//") ||
        value.split("/").some((segment) => segment === "." || segment === "..")) {
        return false;
    }
    return true;
}
export function parseContractManifest(value) {
    if (!isRecord(value) ||
        !hasExactKeys(value, [
            "repository",
            "digest",
            "content_license",
            "files",
        ]) ||
        value.repository !== CONTRACT_REPOSITORY ||
        JSON.stringify(value.digest) !== JSON.stringify(CONTRACT_DIGEST_FRAMING) ||
        !isRecord(value.files) ||
        !hasExactKeys(value.files, CONTRACT_FILE_KEYS)) {
        throw new Error("bundle_validation_failed");
    }
    const policy = parsePolicy(value.content_license);
    if (policy === null)
        throw new Error("bundle_validation_failed");
    const paths = [];
    for (const key of CONTRACT_FILE_KEYS) {
        const path = value.files[key];
        if (!isCanonicalBundlePath(path)) {
            throw new Error("bundle_validation_failed");
        }
        paths.push(path);
    }
    if (new Set(paths).size !== paths.length) {
        throw new Error("bundle_validation_failed");
    }
    return {
        repository: CONTRACT_REPOSITORY,
        digest: CONTRACT_DIGEST_FRAMING,
        content_license: policy,
        files: value.files,
    };
}
export async function loadContractManifest(repositoryRoot) {
    await requireNoFollowPath(repositoryRoot, "contract/contract.json", "file");
    const source = await readFile(resolve(repositoryRoot, "contract/contract.json"), "utf8");
    return parseContractManifest(JSON.parse(source));
}
export function contractBundlePaths(manifest) {
    return ["contract/contract.json", ...Object.values(manifest.files)].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}
