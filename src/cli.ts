#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { digestContractBundle } from "./contract/digest.ts";
import type { ContractPin } from "./contract/types.ts";
import { projectIndexBytes } from "./projection/index.ts";
import { validateCommittedIndex } from "./validation/index.ts";
import { validateRepository } from "./validation/repository.ts";
import { requireNoFollowPath } from "./validation/filesystem.ts";

interface Output {
  write(value: string): unknown;
}

function emit(output: Output, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`);
}

async function safeIndexTarget(root: string): Promise<string> {
  await requireNoFollowPath(root, "roastery", "directory");
  const indexPath = join(root, "roastery", "index.json");
  try {
    await requireNoFollowPath(root, "roastery/index.json", "file", true);
  } catch {
    throw new Error("unsafe_index_path");
  }
  return indexPath;
}

async function writeIndex(
  root: string,
): Promise<{ bytes: string; path: string }> {
  const indexPath = await safeIndexTarget(root);
  const bytes = await projectIndexBytes(root);
  const temporaryPath = join(
    dirname(indexPath),
    `.index.json.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    await mkdir(dirname(indexPath), { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, indexPath);
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { bytes, path: "roastery/index.json" };
}

function invalidArguments(output: Output): number {
  emit(output, { status: "invalid", reason: "invalid_command" });
  return 1;
}

export async function runCli(
  arguments_: string[],
  output: Output = process.stdout,
): Promise<number> {
  try {
    if (
      arguments_.length === 11 &&
      arguments_[0] === "validate" &&
      arguments_[1] === "--root" &&
      arguments_[3] === "--trusted-contract-repository" &&
      arguments_[5] === "--trusted-contract-commit" &&
      arguments_[7] === "--trusted-contract-digest" &&
      arguments_[9] === "--format" &&
      arguments_[10] === "json"
    ) {
      const expectedContract = {
        repository: arguments_[4],
        commit: arguments_[6],
        digest: arguments_[8],
      } as ContractPin;
      const result = await validateRepository(
        arguments_[2] as string,
        expectedContract,
      );
      emit(output, result);
      return result.status === "valid" ? 0 : 1;
    }
    if (
      arguments_.length === 5 &&
      arguments_[0] === "contract-digest" &&
      arguments_[1] === "--root" &&
      arguments_[3] === "--format" &&
      arguments_[4] === "json"
    ) {
      const digest = await digestContractBundle(arguments_[2] as string);
      emit(output, { status: "valid", digest });
      return 0;
    }
    if (
      (arguments_.length === 3 || arguments_.length === 4) &&
      arguments_[0] === "project-index" &&
      arguments_[1] === "--root" &&
      (arguments_.length === 3 || arguments_[3] === "--check")
    ) {
      const root = arguments_[2] as string;
      if (arguments_[3] === "--check") {
        const result = await validateCommittedIndex(root);
        if (result.status === "invalid") {
          emit(output, result);
          return 1;
        }
        emit(output, { status: "valid", path: "roastery/index.json" });
        return 0;
      }
      const projected = await writeIndex(root);
      emit(output, {
        status: "projected",
        path: projected.path,
        digest: `sha256:${createHash("sha256").update(projected.bytes).digest("hex")}`,
      });
      return 0;
    }
    return invalidArguments(output);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unexpected_error";
    emit(output, {
      status: "invalid",
      reason: /^[a-z0-9_]+$/u.test(reason) ? reason : "validation_failed",
    });
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
