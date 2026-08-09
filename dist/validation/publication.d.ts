export declare const OWNER_PUBLICATION_ATTESTATION: "I attest that this Bean contains no embedded third-party material requiring attribution or prior-modification notices beyond the current Standard Roastery declaration and citation contract; Origin URLs and the resources they identify are references outside this Bean license.";
export interface BeanPublicationInput {
    headSha: string;
    changedPaths: string[];
    beanPath: string;
    attestedBeanPath: string;
    beanDigest: string;
    attestedBeanDigest: string;
    changeSetDigest: string;
    attestedChangeSetDigest: string;
    attestedHeadSha: string;
    attestation: string;
    accepted: boolean;
    embeddedThirdPartyNoticesRequired: boolean;
}
type Rejected = {
    status: "rejected";
    reason: string;
};
export declare function validateBeanPublication(input: BeanPublicationInput): {
    status: "accepted";
} | Rejected;
export {};
