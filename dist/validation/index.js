import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectIndex } from "../projection/index.js";
import { requireNoFollowPath } from "./filesystem.js";
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export async function validateCommittedIndex(root, validateIndexStructure, validateBeanStructure) {
    let indexState;
    try {
        indexState = await requireNoFollowPath(root, "roastery/index.json", "file", true);
    }
    catch {
        return { status: "invalid", reason: "unsafe_repository_path" };
    }
    if (indexState === "missing") {
        return { status: "invalid", reason: "missing_index" };
    }
    let source;
    try {
        source = await readFile(join(root, "roastery", "index.json"), "utf8");
    }
    catch {
        return { status: "invalid", reason: "missing_index" };
    }
    let parsed;
    try {
        parsed = JSON.parse(source);
    }
    catch {
        return { status: "invalid", reason: "invalid_index" };
    }
    if (validateIndexStructure !== undefined && !validateIndexStructure(parsed)) {
        return { status: "invalid", reason: "invalid_index" };
    }
    if (!isRecord(parsed) ||
        Object.keys(parsed).length !== 1 ||
        !Array.isArray(parsed.beans)) {
        return { status: "invalid", reason: "invalid_index" };
    }
    const ids = parsed.beans.map((entry) => isRecord(entry) && typeof entry.id === "string" ? entry.id : null);
    if (ids.every((id) => id !== null) &&
        new Set(ids).size !== ids.length) {
        return { status: "invalid", reason: "duplicate_bean_id" };
    }
    let projected;
    try {
        projected = await projectIndex(root, validateBeanStructure);
    }
    catch (error) {
        return {
            status: "invalid",
            reason: error instanceof Error && error.message === "unsafe_repository_path"
                ? "unsafe_repository_path"
                : "invalid_bean",
        };
    }
    if (parsed.beans.length !== projected.beans.length) {
        return { status: "invalid", reason: "index_bean_set_mismatch" };
    }
    for (let index = 0; index < projected.beans.length; index += 1) {
        const actual = parsed.beans[index];
        const expected = projected.beans[index];
        if (!isRecord(actual) ||
            Object.keys(actual).sort().join(",") !== "content_digest,id" ||
            actual.id !== expected?.id) {
            return { status: "invalid", reason: "index_bean_set_mismatch" };
        }
        if (actual.content_digest !== expected.content_digest) {
            return { status: "invalid", reason: "index_digest_mismatch" };
        }
    }
    const canonicalSource = `${JSON.stringify(projected, null, 2)}\n`;
    if (source !== canonicalSource) {
        return { status: "invalid", reason: "index_not_canonical" };
    }
    return { status: "valid", index: projected };
}
