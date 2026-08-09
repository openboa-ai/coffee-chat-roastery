export type RoasteryCommand = "validate" | "project-index" | "contract-digest";

export interface NotImplementedResult {
  command: RoasteryCommand;
  status: "not_implemented";
}

function deferred(command: RoasteryCommand): NotImplementedResult {
  return { command, status: "not_implemented" };
}

export function validate(): NotImplementedResult {
  return deferred("validate");
}

export function projectIndex(): NotImplementedResult {
  return deferred("project-index");
}

export function contractDigest(): NotImplementedResult {
  return deferred("contract-digest");
}
