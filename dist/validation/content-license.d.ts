import { CONTENT_LICENSE_IDENTIFIER, CONTENT_LICENSE_SCOPE, CONTENT_LICENSE_URL } from "../contract/types.ts";
export interface SupportedContentLicense {
    scope: typeof CONTENT_LICENSE_SCOPE;
    license: typeof CONTENT_LICENSE_IDENTIFIER;
    attribution: string;
    official_license_url: typeof CONTENT_LICENSE_URL;
}
export type ContentLicenseParseResult = {
    status: "supported";
    declaration: SupportedContentLicense;
} | {
    status: "invalid_content_license";
    reason: string;
} | {
    status: "unsupported_content_license";
    identifier: string;
};
type StructuralValidator = (value: unknown) => boolean;
export declare function parseContentLicense(input: string | Uint8Array, validateStructure?: StructuralValidator): ContentLicenseParseResult;
export {};
