import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { captureDirectory, readVerifiedFile, verifyDirectories, verifyFiles, } from "./verified-read.js";
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
function length(value) {
    const framed = Buffer.alloc(8);
    framed.writeBigUInt64BE(BigInt(value));
    return framed;
}
export function computeContractDigest(repositoryRoot) {
    try {
        const repository = captureDirectory(resolve(repositoryRoot), [], "unsafe_contract_entry");
        const contractRoot = resolve(repository.path, "contract");
        const root = captureDirectory(contractRoot, [repository], "unsafe_contract_entry");
        const schemas = captureDirectory(resolve(contractRoot, "schemas"), [repository, root], "unsafe_contract_entry");
        const templates = captureDirectory(resolve(contractRoot, "templates"), [repository, root], "unsafe_contract_entry");
        const directories = [repository, root, schemas, templates];
        const fileIdentities = [];
        const files = CONTRACT_FILES.map((relativePath) => {
            const ancestors = relativePath.startsWith("schemas/")
                ? [repository, root, schemas]
                : relativePath.startsWith("templates/")
                    ? [repository, root, templates]
                    : [repository, root];
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
