import { lstat } from "node:fs/promises";
import { join } from "node:path";

export type NoFollowPathResult = "present" | "missing";

export async function requireNoFollowPath(
  root: string,
  relativePath: string,
  expected: "directory" | "file",
  allowMissing = false,
): Promise<NoFollowPathResult> {
  const segments = relativePath.split("/");
  if (
    relativePath.length === 0 ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error("unsafe_repository_path");
  }

  let rootMetadata;
  try {
    rootMetadata = await lstat(root);
  } catch {
    throw new Error("unsafe_repository_path");
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("unsafe_repository_path");
  }

  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index] as string);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (
        allowMissing &&
        index === segments.length - 1 &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return "missing";
      }
      throw new Error("unsafe_repository_path");
    }
    if (metadata.isSymbolicLink()) {
      throw new Error("unsafe_repository_path");
    }
    const requiredType = index === segments.length - 1 ? expected : "directory";
    if (
      (requiredType === "directory" && !metadata.isDirectory()) ||
      (requiredType === "file" && !metadata.isFile())
    ) {
      throw new Error("unsafe_repository_path");
    }
  }
  return "present";
}
