export declare const CONTENT_LICENSE_SCOPE: "roastery/beans/**";
export declare const CONTENT_LICENSE_ID: "CC-BY-4.0";
export declare const CONTENT_LICENSE_URL: "https://creativecommons.org/licenses/by/4.0/";
export declare const ATTRIBUTION_PLACEHOLDER: "<OWNER_PROVIDED_ATTRIBUTION>";
export type ContentLicenseErrorCode = "invalid_content_license" | "unsupported_content_license";
export declare class ContentLicenseError extends Error {
    readonly code: ContentLicenseErrorCode;
    constructor(code: ContentLicenseErrorCode, message: string);
}
export interface ContentLicense {
    attribution: string;
    content: string;
    digest: `sha256:${string}`;
    license: typeof CONTENT_LICENSE_ID;
    scope: typeof CONTENT_LICENSE_SCOPE;
}
export declare function renderContentLicense(attributionInput: string): ContentLicense;
export declare function parseContentLicense(source: string): ContentLicense;
