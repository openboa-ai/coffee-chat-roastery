#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { digestContractBundle } from "./contract/digest.js";
import { projectIndexBytes } from "./projection/index.js";
import { validateCommittedIndex } from "./validation/index.js";
import { validateRepository } from "./validation/repository.js";
import { requireNoFollowPath } from "./validation/filesystem.js";
import { validateContractBundle } from "./validation/contract-bundle.js";
import { CONTRACT_REPOSITORY } from "./contract/types.js";
const PACKAGE_ROOT = dirname(import.meta.dirname);
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
function emit(output, value) {
    output.write(`${JSON.stringify(value)}\n`);
}
async function safeIndexTarget(root) {
    await requireNoFollowPath(root, "roastery", "directory");
    const indexPath = join(root, "roastery", "index.json");
    try {
        await requireNoFollowPath(root, "roastery/index.json", "file", true);
    }
    catch {
        throw new Error("unsafe_index_path");
    }
    return indexPath;
}
async function writeIndex(root, validateBeanStructure) {
    const indexPath = await safeIndexTarget(root);
    const bytes = await projectIndexBytes(root, validateBeanStructure);
    const temporaryPath = join(dirname(indexPath), `.index.json.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
    let handle;
    try {
        await mkdir(dirname(indexPath), { recursive: false });
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
    }
    try {
        handle = await open(temporaryPath, "wx", 0o600);
        await handle.writeFile(bytes, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporaryPath, indexPath);
    }
    catch (error) {
        if (handle !== undefined)
            await handle.close().catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
    }
    return { bytes, path: "roastery/index.json" };
}
function invalidArguments(output) {
    emit(output, { status: "invalid", reason: "invalid_command" });
    return 1;
}
export async function runCli(arguments_, output = process.stdout) {
    try {
        const sourceValidation = arguments_.length === 5 &&
            arguments_[0] === "validate" &&
            arguments_[1] === "--root" &&
            arguments_[3] === "--format" &&
            arguments_[4] === "json";
        const pinnedValidation = arguments_.length === 9 &&
            arguments_[0] === "validate" &&
            arguments_[1] === "--root" &&
            arguments_[3] === "--contract-commit" &&
            COMMIT.test(arguments_[4]) &&
            arguments_[5] === "--contract-digest" &&
            DIGEST.test(arguments_[6]) &&
            arguments_[7] === "--format" &&
            arguments_[8] === "json";
        if (sourceValidation || pinnedValidation) {
            const expectedContract = pinnedValidation
                ? {
                    repository: CONTRACT_REPOSITORY,
                    commit: arguments_[4],
                    digest: arguments_[6],
                }
                : undefined;
            const result = await validateRepository(arguments_[2], expectedContract);
            emit(output, result);
            return result.status === "valid" ? 0 : 1;
        }
        if (arguments_.length === 5 &&
            arguments_[0] === "contract-digest" &&
            arguments_[1] === "--root" &&
            arguments_[3] === "--format" &&
            arguments_[4] === "json") {
            const digest = await digestContractBundle(arguments_[2]);
            emit(output, { status: "valid", digest });
            return 0;
        }
        if ((arguments_.length === 3 || arguments_.length === 4) &&
            arguments_[0] === "project-index" &&
            arguments_[1] === "--root" &&
            (arguments_.length === 3 || arguments_[3] === "--check")) {
            const root = arguments_[2];
            const bundle = await validateContractBundle(PACKAGE_ROOT);
            if (arguments_[3] === "--check") {
                const result = await validateCommittedIndex(root, bundle.schemas.index, bundle.schemas.beanFrontmatter);
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
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : "unexpected_error";
        emit(output, {
            status: "invalid",
            reason: /^[a-z0-9_]+$/u.test(reason) ? reason : "validation_failed",
        });
        return 1;
    }
}
function isMainModule() {
    try {
        return (process.argv[1] !== undefined &&
            realpathSync(process.argv[1]) === fileURLToPath(import.meta.url));
    }
    catch {
        return false;
    }
}
if (isMainModule()) {
    process.exitCode = await runCli(process.argv.slice(2));
}
