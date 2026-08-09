import { CONTRACT_REPOSITORY, } from "../contract/types.js";
const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/u;
const REPOSITORY_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9_-])?$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sameKeys(value, expected) {
    return (JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()));
}
export function parseRepositoryIdentity(value) {
    if (typeof value !== "string")
        return null;
    try {
        const url = new URL(value);
        const path = /^\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
        const owner = path?.[1] ?? "";
        const repository = path?.[2] ?? "";
        const canonical = `https://github.com/${owner}/${repository}`;
        if (url.protocol !== "https:" ||
            url.hostname !== "github.com" ||
            url.port !== "" ||
            url.username !== "" ||
            url.password !== "" ||
            url.search !== "" ||
            url.hash !== "" ||
            value !== canonical ||
            !OWNER.test(owner) ||
            !REPOSITORY_NAME.test(repository) ||
            repository.endsWith(".git")) {
            return null;
        }
        return canonical;
    }
    catch {
        return null;
    }
}
export function validateRoasteryManifest(value, expectedContract) {
    if (!isRecord(value) || !sameKeys(value, ["repository", "contract"])) {
        return { status: "invalid", reason: "invalid_roastery_manifest" };
    }
    if (parseRepositoryIdentity(value.repository) === null) {
        return { status: "invalid", reason: "invalid_repository" };
    }
    if (!isRecord(value.contract) ||
        !sameKeys(value.contract, ["repository", "commit", "digest"])) {
        return { status: "invalid", reason: "invalid_contract_pin" };
    }
    const contract = value.contract;
    if (contract.repository !== CONTRACT_REPOSITORY ||
        typeof contract.commit !== "string" ||
        !COMMIT.test(contract.commit) ||
        typeof contract.digest !== "string" ||
        !DIGEST.test(contract.digest)) {
        return { status: "invalid", reason: "invalid_contract_pin" };
    }
    const manifest = value;
    if (expectedContract !== undefined &&
        (manifest.contract.repository !== expectedContract.repository ||
            manifest.contract.commit !== expectedContract.commit ||
            manifest.contract.digest !== expectedContract.digest)) {
        return { status: "invalid", reason: "contract_mismatch" };
    }
    return { status: "valid", manifest };
}
