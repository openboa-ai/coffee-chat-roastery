import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import { isIP } from "node:net";
import { basename, relative, resolve, sep } from "node:path";
import { ContentLicenseError, parseContentLicense } from "./content-license.js";
const OFFICIAL_REPOSITORY = "https://github.com/openboa-ai/coffee-chat-roastery";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
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
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        fail(code);
    }
    return object(parsed, keys, code);
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
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    if (url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== "" ||
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local")) {
        return false;
    }
    if (isIP(host) === 4) {
        const octets = host.split(".").map(Number);
        if (octets[0] === 10 ||
            octets[0] === 127 ||
            (octets[0] === 169 && octets[1] === 254) ||
            (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
            (octets[0] === 192 && octets[1] === 168)) {
            return false;
        }
    }
    if (isIP(host) === 6 &&
        (host === "::1" || /^f[cd]/u.test(host) || /^fe[89ab]/u.test(host))) {
        return false;
    }
    return true;
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
        for (const line of header) {
            if (!line.startsWith("  - ") || !publicOrigin(line.slice(4))) {
                fail("invalid_origin");
            }
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
    if (!existsSync(directory))
        return [];
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
export function projectIndex({ root, write = false, }) {
    const beans = scanBeans(root);
    if (write) {
        const roasteryRoot = resolve(root, "roastery");
        safeChild(root, roasteryRoot);
        const indexPath = resolve(roasteryRoot, "index.json");
        if (existsSync(indexPath))
            safeChild(root, indexPath);
        const temporaryPath = resolve(roasteryRoot, `.index-${process.pid}-${randomUUID()}.tmp`);
        try {
            writeFileSync(temporaryPath, indexBytes(beans), {
                encoding: "utf8",
                flag: "wx",
                mode: 0o600,
            });
            renameSync(temporaryPath, indexPath);
        }
        finally {
            rmSync(temporaryPath, { force: true });
        }
    }
    return { beans, status: "projected", wrote: write };
}
export function validate({ root, mode, }) {
    try {
        const roasteryRoot = resolve(root, "roastery");
        safeChild(root, roasteryRoot);
        const manifest = readJson(resolve(roasteryRoot, "roastery.json"), ["contract", "repository"], "invalid_roastery");
        const repository = normalizeRepository(manifest.repository);
        contractPin(manifest.contract);
        const beans = scanBeans(root);
        const indexPath = resolve(roasteryRoot, "index.json");
        safeChild(root, indexPath);
        const index = readJson(indexPath, ["beans"], "invalid_index");
        if (!Array.isArray(index.beans) ||
            readFileSync(indexPath, "utf8") !== indexBytes(beans)) {
            fail("stale_index");
        }
        const licensePath = resolve(roasteryRoot, "CONTENT_LICENSE.md");
        if (mode === "seed") {
            if (repository !== OFFICIAL_REPOSITORY ||
                beans.length !== 0 ||
                existsSync(licensePath)) {
                fail("invalid_seed");
            }
        }
        else {
            if (repository === OFFICIAL_REPOSITORY ||
                !repository.endsWith("/coffee-chat")) {
                fail("invalid_repository_identity");
            }
            if (!existsSync(licensePath))
                fail("invalid_content_license");
            safeChild(root, licensePath);
            parseContentLicense(readFileSync(licensePath, "utf8"));
        }
        return { beanCount: beans.length, repository, status: "valid" };
    }
    catch (error) {
        if (error instanceof ContentLicenseError) {
            return { code: error.code, status: "invalid" };
        }
        if (error instanceof ValidationError) {
            return { code: error.code, status: "invalid" };
        }
        return { code: "invalid_roastery", status: "invalid" };
    }
}
