export interface FakeReviewRecord {
  reviewer: string;
  headSha: string;
  state: "approved" | "changes_requested" | "commented";
}

export function fakeGithubReviews(
  records: FakeReviewRecord[],
): FakeReviewRecord[] {
  return records.map((record) => ({ ...record }));
}
