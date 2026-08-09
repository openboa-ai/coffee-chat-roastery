export interface ContentLicenseRenderInput {
    scope: string;
    license: string;
    attribution: string;
}
export declare function normalizeOwnerAttribution(value: unknown): string;
export declare function renderContentLicense(input: ContentLicenseRenderInput): string;
