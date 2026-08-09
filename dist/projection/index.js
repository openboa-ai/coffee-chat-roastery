import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { validateBeanFile, } from "../validation/bean.js";
import { requireNoFollowPath } from "../validation/filesystem.js";
export async function projectIndex(root, validateBeanStructure) {
    const beansRoot = join(root, "roastery", "beans");
    await requireNoFollowPath(root, "roastery", "directory");
    const beansState = await requireNoFollowPath(root, "roastery/beans", "directory", true);
    if (beansState === "missing")
        return { beans: [] };
    let entries;
    try {
        entries = await readdir(beansRoot, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === "ENOENT")
            return { beans: [] };
        throw error;
    }
    const beans = [];
    for (const entry of entries) {
        if (!entry.isFile() ||
            entry.isSymbolicLink() ||
            !entry.name.endsWith(".md")) {
            throw new Error(`invalid Bean path: roastery/beans/${entry.name}`);
        }
        const relativePath = `roastery/beans/${entry.name}`;
        const bytes = await readFile(join(beansRoot, entry.name));
        const validation = validateBeanFile(relativePath, bytes, validateBeanStructure);
        if (validation.status === "invalid") {
            throw new Error(`${validation.reason}: ${relativePath}`);
        }
        beans.push({
            id: validation.bean.id,
            content_digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        });
    }
    beans.sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)));
    return { beans };
}
export async function projectIndexBytes(root, validateBeanStructure) {
    return `${JSON.stringify(await projectIndex(root, validateBeanStructure), null, 2)}\n`;
}
