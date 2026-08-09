#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeContractDigest, projectIndex, validate, } from "./index.js";
function value(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}
function output(result, success) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = success ? 0 : 1;
}
function root() {
    const candidate = value("--root");
    if (!candidate)
        throw new Error("missing_root");
    return resolve(candidate);
}
function inferredMode(repositoryRoot) {
    try {
        const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "roastery", "roastery.json"), "utf8"));
        return manifest.repository ===
            "https://github.com/openboa-ai/coffee-chat-roastery"
            ? "seed"
            : "initialized";
    }
    catch {
        return "initialized";
    }
}
function expectedContract() {
    const commit = value("--contract-commit");
    const digest = value("--contract-digest");
    if (!commit || !digest)
        throw new Error("contract_expectation_required");
    return {
        repository: "https://github.com/openboa-ai/coffee-chat-roastery",
        commit,
        digest: digest,
    };
}
try {
    const command = process.argv[2];
    if (command === "contract-digest") {
        output({ digest: computeContractDigest(root()), status: "valid" }, true);
    }
    else if (command === "validate") {
        const repositoryRoot = root();
        const result = validate({
            root: repositoryRoot,
            mode: inferredMode(repositoryRoot),
            expectedContract: expectedContract(),
        });
        output(result, result.status === "valid");
    }
    else if (command === "project-index") {
        const repositoryRoot = root();
        const check = process.argv.includes("--check");
        const projected = projectIndex({ root: repositoryRoot });
        if (check) {
            const current = readFileSync(resolve(repositoryRoot, "roastery", "index.json"), "utf8");
            output(current === projected.bytes
                ? { beans: projected.beans.length, status: "valid" }
                : { code: "stale_index", status: "invalid" }, current === projected.bytes);
        }
        else {
            output(projected, true);
        }
    }
    else {
        process.stderr.write("unknown command; use validate, project-index, or contract-digest\n");
        process.exitCode = 1;
    }
}
catch (error) {
    output({
        code: error instanceof Error ? error.message : "command_failed",
        status: "invalid",
    }, false);
}
