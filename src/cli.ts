#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { digestContractBundle } from "./contract/digest.ts";
import { projectIndexBytes } from "./projection/index.ts";
import { validateCommittedIndex } from "./validation/index.ts";
import { validateRepository } from "./validation/repository.ts";
import { requireNoFollowPath } from "./validation/filesystem.ts";
import { validateContractBundle } from "./validation/contract-bundle.ts";
import type { StructuralValidator } from "./validation/bean.ts";
import { CONTRACT_REPOSITORY, type ContractPin } from "./contract/types.ts";

const PACKAGE_ROOT = dirname(import.meta.dirname);
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

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
  validateBeanStructure?: StructuralValidator,
): Promise<{ bytes: string; path: string }> {
  const indexPath = await safeIndexTarget(root);
  const bytes = await projectIndexBytes(root, validateBeanStructure);
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
    const sourceValidation =
      arguments_.length === 5 &&
      arguments_[0] === "validate" &&
      arguments_[1] === "--root" &&
      arguments_[3] === "--format" &&
      arguments_[4] === "json";
    const pinnedValidation =
      arguments_.length === 9 &&
      arguments_[0] === "validate" &&
      arguments_[1] === "--root" &&
      arguments_[3] === "--contract-commit" &&
      COMMIT.test(arguments_[4] as string) &&
      arguments_[5] === "--contract-digest" &&
      DIGEST.test(arguments_[6] as string) &&
      arguments_[7] === "--format" &&
      arguments_[8] === "json";
    if (sourceValidation || pinnedValidation) {
      const expectedContract: ContractPin | undefined = pinnedValidation
        ? {
            repository: CONTRACT_REPOSITORY,
            commit: arguments_[4] as string,
            digest: arguments_[6] as `sha256:${string}`,
          }
        : undefined;
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
      const bundle = await validateContractBundle(PACKAGE_ROOT);
      if (arguments_[3] === "--check") {
        const result = await validateCommittedIndex(
          root,
          bundle.schemas.index,
          bundle.schemas.beanFrontmatter,
        );
        if (result.status === "invalid") {
          emit(output, result);
          return 1;
        }
        emit(output, { status: "valid", path: "roastery/index.json" });
        return 0;
      }
      const projected = await writeIndex(root, bundle.schemas.beanFrontmatter);
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

function isMainModule(): boolean {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
