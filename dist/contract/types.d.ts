export declare const CONTRACT_REPOSITORY: "https://github.com/openboa-ai/coffee-chat-roastery";
export declare const CONTENT_LICENSE_SCOPE: "roastery/beans/**";
export declare const CONTENT_LICENSE_IDENTIFIER: "CC-BY-4.0";
export declare const CONTENT_LICENSE_URL: "https://creativecommons.org/licenses/by/4.0/";
export type Sha256Digest = `sha256:${string}`;
export interface ContractPin {
    repository: typeof CONTRACT_REPOSITORY;
    commit: string;
    digest: Sha256Digest;
}
export interface RoasteryManifest {
    repository: string;
    contract: ContractPin;
}
export interface Bean {
    id: string;
    origins?: string[];
    body: string;
}
export interface IndexEntry {
    id: string;
    content_digest: Sha256Digest;
}
export interface RoasteryIndex {
    beans: IndexEntry[];
}
export interface ContentLicensePolicy {
    scope: string;
    spdx_identifier: string;
    official_license_url: string;
    attribution_normalization: "NFC" | "NFD";
    supported: boolean;
    attribution_required: boolean;
    change_indication_required: boolean;
    product_provenance_required: boolean;
}
