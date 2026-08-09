export const OWNER_PUBLICATION_ATTESTATION =
  "I attest that this Bean contains no embedded third-party material requiring attribution or prior-modification notices beyond the current Standard Roastery declaration and citation contract; Origin URLs and the resources they identify are references outside this Bean license." as const;

const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BEAN_PATH =
  /^roastery\/beans\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/u;

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

type Rejected = { status: "rejected"; reason: string };

export function validateBeanPublication(
  input: BeanPublicationInput,
): { status: "accepted" } | Rejected {
  if (input.embeddedThirdPartyNoticesRequired) {
    return {
      status: "rejected",
      reason: "unrepresentable_third_party_notice",
    };
  }
  if (!input.accepted || input.attestation !== OWNER_PUBLICATION_ATTESTATION) {
    return { status: "rejected", reason: "attestation_required" };
  }
  const expectedPaths = [input.beanPath, "roastery/index.json"].sort();
  if (
    !BEAN_PATH.test(input.beanPath) ||
    JSON.stringify([...input.changedPaths].sort()) !==
      JSON.stringify(expectedPaths)
  ) {
    return { status: "rejected", reason: "invalid_publication_paths" };
  }
  if (
    !COMMIT.test(input.headSha) ||
    !DIGEST.test(input.beanDigest) ||
    !DIGEST.test(input.changeSetDigest) ||
    input.attestedHeadSha !== input.headSha ||
    input.attestedBeanPath !== input.beanPath ||
    input.attestedBeanDigest !== input.beanDigest ||
    input.attestedChangeSetDigest !== input.changeSetDigest
  ) {
    return { status: "rejected", reason: "attestation_binding_mismatch" };
  }
  return { status: "accepted" };
}
