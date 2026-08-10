import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { captureDirectory, readVerifiedFile, verifyDirectories, verifyFiles, } from "./verified-read.js";
function contractFiles(root, current, ancestors, allDirectories, allFiles) {
    try {
        const directory = captureDirectory(current, ancestors, "unsafe_contract_entry");
        allDirectories.push(directory);
        const directories = [...ancestors, directory];
        const files = readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
            const absolute = resolve(current, entry.name);
            const stat = lstatSync(absolute);
            if (stat.isSymbolicLink())
                throw new Error("unsafe_contract_entry");
            if (stat.isDirectory())
                return contractFiles(root, absolute, directories, allDirectories, allFiles);
            if (!stat.isFile())
                throw new Error("unsafe_contract_entry");
            return [
                {
                    content: readVerifiedFile(absolute, directories, allFiles, "unsafe_contract_entry"),
                    path: Buffer.from(relative(root, absolute).split(sep).join("/"), "utf8"),
                },
            ];
        });
        verifyDirectories(directories, "unsafe_contract_entry");
        return files;
    }
    catch {
        throw new Error("unsafe_contract_entry");
    }
}
function length(value) {
    const framed = Buffer.alloc(8);
    framed.writeBigUInt64BE(BigInt(value));
    return framed;
}
export function computeContractDigest(repositoryRoot) {
    const contractRoot = resolve(repositoryRoot, "contract");
    const directories = [];
    const fileIdentities = [];
    const files = contractFiles(contractRoot, contractRoot, [], directories, fileIdentities).sort((left, right) => left.path.compare(right.path));
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
