import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { basename, relative, resolve, sep } from "node:path";
import { ContentLicenseError, parseContentLicense } from "./content-license.js";
const OFFICIAL_REPOSITORY = "https://github.com/openboa-ai/coffee-chat-roastery";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SPECIAL_USE_DNS_TLDS = new Set([
    "alt",
    "arpa",
    "example",
    "internal",
    "invalid",
    "local",
    "localhost",
    "onion",
    "test",
]);
class ValidationError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
function fail(code) {
    throw new ValidationError(code);
}
function invalidResult(error) {
    if (error instanceof ContentLicenseError ||
        error instanceof ValidationError) {
        return { code: error.code, status: "invalid" };
    }
    return { code: "invalid_roastery", status: "invalid" };
}
function object(value, keys, code) {
    if (typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        JSON.stringify(Object.keys(value).sort()) !==
            JSON.stringify([...keys].sort())) {
        fail(code);
    }
    return value;
}
function readJson(path, keys, code) {
    let source;
    let parsed;
    try {
        source = readFileSync(path, "utf8");
        parsed = JSON.parse(source);
    }
    catch {
        fail(code);
    }
    const result = object(parsed, keys, code);
    if (source !== `${JSON.stringify(parsed, null, 2)}\n`)
        fail(code);
    return result;
}
function normalizeRepository(value) {
    if (typeof value !== "string")
        fail("invalid_repository_identity");
    let url;
    try {
        url = new URL(value);
    }
    catch {
        fail("invalid_repository_identity");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" ||
        url.hostname !== "github.com" ||
        url.port !== "" ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        parts.length !== 2 ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(parts[0] ?? "") ||
        !/^[A-Za-z0-9._-]+$/u.test(parts[1] ?? "") ||
        parts[1]?.endsWith(".git")) {
        fail("invalid_repository_identity");
    }
    return `https://github.com/${parts[0]}/${parts[1]}`;
}
function contractPin(value) {
    const pin = object(value, ["commit", "digest", "repository"], "contract_mismatch");
    if (pin.repository !== OFFICIAL_REPOSITORY ||
        typeof pin.commit !== "string" ||
        !SHA.test(pin.commit) ||
        typeof pin.digest !== "string" ||
        !DIGEST.test(pin.digest)) {
        fail("contract_mismatch");
    }
    return pin;
}
function safeChild(root, path) {
    const lexicalRoot = resolve(root);
    const candidate = resolve(path);
    const child = relative(lexicalRoot, candidate);
    if (child === ".." ||
        child.startsWith(`..${sep}`) ||
        resolve(lexicalRoot, child) !== candidate) {
        fail("unsafe_path");
    }
    let cursor = lexicalRoot;
    for (const segment of child.split(sep).filter(Boolean)) {
        cursor = resolve(cursor, segment);
        if (lstatSync(cursor).isSymbolicLink())
            fail("unsafe_path");
    }
    const canonicalRoot = realpathSync(lexicalRoot);
    const canonicalCandidate = realpathSync(candidate);
    if (canonicalCandidate !== canonicalRoot &&
        !canonicalCandidate.startsWith(`${canonicalRoot}${sep}`)) {
        fail("unsafe_path");
    }
}
function publicOrigin(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return false;
    }
    const host = url.hostname
        .toLowerCase()
        .replace(/^\[|\]$/gu, "")
        .replace(/\.$/u, "");
    if (url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== "" ||
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local")) {
        return false;
    }
    const labels = host.split(".");
    return (isIP(host) === 0 &&
        host.length <= 253 &&
        labels.length >= 2 &&
        !SPECIAL_USE_DNS_TLDS.has(labels.at(-1) ?? "") &&
        labels.every((label) => /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/u.test(label)));
}
function parseBean(path) {
    const content = readFileSync(path);
    const source = content.toString("utf8");
    if (!source.startsWith("---\n"))
        fail("invalid_bean");
    const end = source.indexOf("\n---\n", 4);
    if (end < 0)
        fail("invalid_bean");
    const header = source.slice(4, end).split("\n");
    const body = source.slice(end + 5);
    const idLine = header.shift();
    if (!idLine?.startsWith("id: "))
        fail("invalid_bean");
    const id = idLine.slice(4);
    if (!UUID_V7.test(id))
        fail("invalid_bean_id");
    if (header.length > 0) {
        if (header.shift() !== "origins:" || header.length === 0)
            fail("invalid_bean");
        const origins = new Set();
        for (const line of header) {
            const origin = line.slice(4);
            if (!line.startsWith("  - ") ||
                origin.trim() !== origin ||
                !publicOrigin(origin)) {
                fail("invalid_origin");
            }
            if (origins.has(origin))
                fail("duplicate_origin");
            origins.add(origin);
        }
    }
    if (body.trim().length === 0)
        fail("invalid_bean");
    if (basename(path) !== `${id}.md`)
        fail("invalid_bean_path");
    return { content, id };
}
function scanBeans(root) {
    const roasteryRoot = resolve(root, "roastery");
    safeChild(root, roasteryRoot);
    const directory = resolve(root, "roastery", "beans");
    const directoryEntry = lstatSync(directory, { throwIfNoEntry: false });
    if (directoryEntry === undefined)
        return [];
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) {
        fail("unsafe_path");
    }
    safeChild(root, directory);
    const ids = new Set();
    const entries = readdirSync(directory, { withFileTypes: true });
    const beans = [];
    for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (!entry.isFile() || entry.isSymbolicLink())
            fail("unsafe_path");
        safeChild(root, path);
        if (!entry.name.endsWith(".md"))
            fail("invalid_bean_path");
        const bean = parseBean(path);
        if (ids.has(bean.id))
            fail("duplicate_bean_id");
        ids.add(bean.id);
        beans.push({
            id: bean.id,
            digest: `sha256:${createHash("sha256").update(bean.content).digest("hex")}`,
        });
    }
    return beans.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
function indexBytes(beans) {
    return `${JSON.stringify({ beans }, null, 2)}\n`;
}
export function projectIndex({ root }) {
    const beans = scanBeans(root);
    return { beans, bytes: indexBytes(beans), status: "projected" };
}
export function checkIndex({ root }) {
    try {
        const projected = projectIndex({ root });
        const indexPath = resolve(root, "roastery", "index.json");
        safeChild(root, indexPath);
        if (readFileSync(indexPath, "utf8") !== projected.bytes) {
            fail("stale_index");
        }
        return { beans: projected.beans.length, status: "valid" };
    }
    catch (error) {
        return invalidResult(error);
    }
}
export function validate({ root, mode, expectedContract, }) {
    try {
        const roasteryRoot = resolve(root, "roastery");
        safeChild(root, roasteryRoot);
        const manifestPath = resolve(roasteryRoot, "roastery.json");
        safeChild(root, manifestPath);
        const manifest = readJson(manifestPath, ["contract", "repository"], "invalid_roastery");
        const repository = normalizeRepository(manifest.repository);
        const actualContract = contractPin(manifest.contract);
        const trustedContract = contractPin(expectedContract);
        if (actualContract.repository !== trustedContract.repository ||
            actualContract.commit !== trustedContract.commit ||
            actualContract.digest !== trustedContract.digest) {
            fail("contract_mismatch");
        }
        const beans = scanBeans(root);
        const indexPath = resolve(roasteryRoot, "index.json");
        safeChild(root, indexPath);
        const index = readJson(indexPath, ["beans"], "invalid_index");
        if (!Array.isArray(index.beans) ||
            readFileSync(indexPath, "utf8") !== indexBytes(beans)) {
            fail("stale_index");
        }
        const licensePath = resolve(roasteryRoot, "CONTENT_LICENSE.md");
        const licenseEntry = lstatSync(licensePath, { throwIfNoEntry: false });
        if (licenseEntry !== undefined &&
            (!licenseEntry.isFile() || licenseEntry.isSymbolicLink())) {
            fail("unsafe_path");
        }
        if (licenseEntry !== undefined)
            safeChild(root, licensePath);
        const effectiveMode = mode ?? (repository === OFFICIAL_REPOSITORY ? "seed" : "initialized");
        if (effectiveMode === "seed") {
            if (repository !== OFFICIAL_REPOSITORY ||
                beans.length !== 0 ||
                licenseEntry !== undefined) {
                fail("invalid_seed");
            }
        }
        else {
            if (repository === OFFICIAL_REPOSITORY ||
                !repository.endsWith("/coffee-chat")) {
                fail("invalid_repository_identity");
            }
            if (licenseEntry === undefined)
                fail("invalid_content_license");
            parseContentLicense(readFileSync(licensePath, "utf8"));
        }
        return { beanCount: beans.length, repository, status: "valid" };
    }
    catch (error) {
        return invalidResult(error);
    }
}
