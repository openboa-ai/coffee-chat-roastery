import { CONTRACT_REPOSITORY, type ContentLicensePolicy } from "./types.ts";
export declare const CONTRACT_FILE_KEYS: readonly ["roastery_schema", "index_schema", "bean_frontmatter_schema", "content_license_schema", "content_license_template", "init_contract", "publication_contract", "security_contract", "public_cli", "contract_digest", "contract_manifest_parser", "contract_types", "public_api", "content_license_renderer", "index_projection", "bean_validator", "content_license_parser", "contract_bundle_validator", "filesystem_validator", "index_validator", "publication_validator", "repository_validator", "roastery_validator"];
export declare const SCHEMA_FILE_KEYS: readonly ["roastery_schema", "index_schema", "bean_frontmatter_schema", "content_license_schema"];
export declare const CONTRACT_DIGEST_FRAMING: {
    readonly algorithm: "sha256";
    readonly file_count_bytes: 4;
    readonly path_length_bytes: 4;
    readonly content_length_bytes: 8;
    readonly byte_order: "big-endian";
    readonly path_base: "repository";
    readonly path_order: "utf8-bytewise";
};
export type ContractFileKey = (typeof CONTRACT_FILE_KEYS)[number];
export type SchemaFileKey = (typeof SCHEMA_FILE_KEYS)[number];
export interface ContractManifest {
    repository: typeof CONTRACT_REPOSITORY;
    digest: typeof CONTRACT_DIGEST_FRAMING;
    content_license: ContentLicensePolicy;
    files: Record<ContractFileKey, string>;
}
export declare function parseContractManifest(value: unknown): ContractManifest;
export declare function loadContractManifest(repositoryRoot: string): Promise<ContractManifest>;
export declare function contractBundlePaths(manifest: ContractManifest): string[];
