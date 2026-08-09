import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, } from "node:fs";
import { relative, resolve, sep } from "node:path";
function readVerifiedFile(path) {
    let descriptor;
    try {
        descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(descriptor);
        const current = lstatSync(path);
        if (!opened.isFile() ||
            !current.isFile() ||
            current.isSymbolicLink() ||
            opened.dev !== current.dev ||
            opened.ino !== current.ino) {
            throw new Error("unsafe_contract_entry");
        }
        return readFileSync(descriptor);
    }
    catch {
        throw new Error("unsafe_contract_entry");
    }
    finally {
        if (descriptor !== undefined)
            closeSync(descriptor);
    }
}
function contractFiles(root, current) {
    return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
        const absolute = resolve(current, entry.name);
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink())
            throw new Error("unsafe_contract_entry");
        if (stat.isDirectory())
            return contractFiles(root, absolute);
        if (!stat.isFile())
            throw new Error("unsafe_contract_entry");
        return [
            {
                content: readVerifiedFile(absolute),
                path: Buffer.from(relative(root, absolute).split(sep).join("/"), "utf8"),
            },
        ];
    });
}
function length(value) {
    const framed = Buffer.alloc(8);
    framed.writeBigUInt64BE(BigInt(value));
    return framed;
}
export function computeContractDigest(repositoryRoot) {
    const contractRoot = resolve(repositoryRoot, "contract");
    if (lstatSync(contractRoot).isSymbolicLink()) {
        throw new Error("unsafe_contract_entry");
    }
    const files = contractFiles(contractRoot, contractRoot).sort((left, right) => left.path.compare(right.path));
    const hash = createHash("sha256");
    for (const file of files) {
        hash.update(length(file.path.length));
        hash.update(file.path);
        hash.update(length(file.content.length));
        hash.update(file.content);
    }
    return `sha256:${hash.digest("hex")}`;
}
