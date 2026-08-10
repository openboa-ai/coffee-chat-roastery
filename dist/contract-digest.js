import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { captureDirectory, readVerifiedFile, verifyDirectories, verifyFiles, } from "./verified-read.js";
const ROOT_ENTRIES = [
    "README.md",
    "contract.json",
    "publication.md",
    "schemas",
    "security.md",
    "templates",
];
const SCHEMA_ENTRIES = [
    "bean-frontmatter.schema.json",
    "content-license.schema.json",
    "index.schema.json",
    "roastery.schema.json",
];
const TEMPLATE_ENTRIES = ["content-license.md"];
const CONTRACT_FILES = [
    "README.md",
    "contract.json",
    "publication.md",
    "schemas/bean-frontmatter.schema.json",
    "schemas/content-license.schema.json",
    "schemas/index.schema.json",
    "schemas/roastery.schema.json",
    "security.md",
    "templates/content-license.md",
];
function assertDirectoryEntries(path, expectedNames) {
    const actual = readdirSync(path, { encoding: "buffer" }).sort((left, right) => left.compare(right));
    const expected = expectedNames
        .map((name) => Buffer.from(name, "ascii"))
        .sort((left, right) => left.compare(right));
    if (actual.length !== expected.length ||
        actual.some((name, index) => {
            const expectedName = expected[index];
            return expectedName === undefined || !name.equals(expectedName);
        })) {
        throw new Error("unsafe_contract_entry");
    }
}
function length(value) {
    const framed = Buffer.alloc(8);
    framed.writeBigUInt64BE(BigInt(value));
    return framed;
}
export function computeContractDigest(repositoryRoot) {
    try {
        const contractRoot = resolve(repositoryRoot, "contract");
        const root = captureDirectory(contractRoot, [], "unsafe_contract_entry");
        const schemas = captureDirectory(resolve(contractRoot, "schemas"), [root], "unsafe_contract_entry");
        const templates = captureDirectory(resolve(contractRoot, "templates"), [root], "unsafe_contract_entry");
        const directories = [root, schemas, templates];
        assertDirectoryEntries(contractRoot, ROOT_ENTRIES);
        assertDirectoryEntries(schemas.path, SCHEMA_ENTRIES);
        assertDirectoryEntries(templates.path, TEMPLATE_ENTRIES);
        const fileIdentities = [];
        const files = CONTRACT_FILES.map((relativePath) => {
            const ancestors = relativePath.startsWith("schemas/")
                ? [root, schemas]
                : relativePath.startsWith("templates/")
                    ? [root, templates]
                    : [root];
            return {
                content: readVerifiedFile(resolve(contractRoot, relativePath), ancestors, fileIdentities, "unsafe_contract_entry"),
                path: Buffer.from(relativePath, "ascii"),
            };
        }).sort((left, right) => left.path.compare(right.path));
        verifyDirectories(directories, "unsafe_contract_entry");
        verifyFiles(fileIdentities, "unsafe_contract_entry");
        const hash = createHash("sha256");
        for (const file of files) {
            hash.update(length(file.path.length));
            hash.update(file.path);
            hash.update(length(file.content.length));
            hash.update(file.content);
        }
        return `sha256:${hash.digest("hex")}`;
    }
    catch {
        throw new Error("unsafe_contract_entry");
    }
}
