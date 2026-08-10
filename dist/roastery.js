import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { basename, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import { ContentLicenseError, parseContentLicense } from "./content-license.js";
import { captureDirectory, readVerifiedFile, UnsafeReadError, verifyDirectories, verifyFiles, } from "./verified-read.js";
const OFFICIAL_REPOSITORY = "https://github.com/openboa-ai/coffee-chat-roastery";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const URL_FORBIDDEN_SYNTAX = /[\\\s\u0000-\u001f\u007f-\u009f]/u;
const URI_MALFORMED_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/u;
const UTF8_DECODER = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
});
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
function validationMode(value) {
    if (value === undefined || value === "seed" || value === "initialized") {
        return value;
    }
    fail("invalid_mode");
}
function decodeUtf8(content, code) {
    try {
        return UTF8_DECODER.decode(content);
    }
    catch {
        fail(code);
    }
}
function invalidResult(error) {
    if (error instanceof ContentLicenseError ||
        error instanceof ValidationError ||
        error instanceof UnsafeReadError) {
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
function readJson(path, directories, files, keys, code) {
    let source;
    let parsed;
    try {
        source = decodeUtf8(readVerifiedFile(path, directories, files, "unsafe_path"), code);
        parsed = JSON.parse(source);
    }
    catch (error) {
        if (error instanceof UnsafeReadError)
            throw error;
        fail(code);
    }
    const result = object(parsed, keys, code);
    if (source !== `${JSON.stringify(parsed, null, 2)}\n`)
        fail(code);
    return { document: result, source };
}
function normalizeRepository(value) {
    if (typeof value !== "string" || URL_FORBIDDEN_SYNTAX.test(value)) {
        fail("invalid_repository_identity");
    }
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
    const normalized = `https://github.com/${parts[0]}/${parts[1]}`;
    if (value !== normalized)
        fail("invalid_repository_identity");
    return normalized;
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
    if (URL_FORBIDDEN_SYNTAX.test(value) ||
        URI_MALFORMED_PERCENT_ESCAPE.test(value))
        return false;
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return false;
    }
    const parsedHost = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    const host = parsedHost.replace(/\.$/u, "");
    if (url.href !== value ||
        parsedHost !== host ||
        url.protocol !== "https:" ||
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
function parseBean(path, directories, files) {
    const content = readVerifiedFile(path, directories, files, "unsafe_path");
    const source = decodeUtf8(content, "invalid_bean");
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
function createContext(root) {
    const repositoryRoot = resolve(root);
    const repository = captureDirectory(repositoryRoot, [], "unsafe_path");
    const roasteryRoot = resolve(repositoryRoot, "roastery");
    safeChild(repositoryRoot, roasteryRoot);
    const roastery = captureDirectory(roasteryRoot, [repository], "unsafe_path");
    return {
        directories: [repository, roastery],
        files: [],
        roasteryRoot,
        root: repositoryRoot,
    };
}
function scanBeans(context) {
    const directory = resolve(context.roasteryRoot, "beans");
    const directoryEntry = lstatSync(directory, { throwIfNoEntry: false });
    if (directoryEntry === undefined) {
        verifyDirectories(context.directories, "unsafe_path");
        return [];
    }
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) {
        fail("unsafe_path");
    }
    safeChild(context.root, directory);
    const beansDirectory = captureDirectory(directory, context.directories, "unsafe_path");
    context.directories.push(beansDirectory);
    const ids = new Set();
    const entries = readdirSync(directory, { withFileTypes: true });
    const beans = [];
    for (const entry of entries) {
        const path = resolve(directory, entry.name);
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink())
            fail("unsafe_path");
        safeChild(context.root, path);
        if (!entry.name.endsWith(".md"))
            fail("invalid_bean_path");
        const bean = parseBean(path, context.directories, context.files);
        if (ids.has(bean.id))
            fail("duplicate_bean_id");
        ids.add(bean.id);
        beans.push({
            id: bean.id,
            digest: `sha256:${createHash("sha256").update(bean.content).digest("hex")}`,
        });
    }
    verifyDirectories(context.directories, "unsafe_path");
    verifyFiles(context.files, "unsafe_path");
    return beans.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
function indexBytes(beans) {
    return `${JSON.stringify({ beans }, null, 2)}\n`;
}
export function projectIndex({ root }) {
    const context = createContext(root);
    const beans = scanBeans(context);
    verifyDirectories(context.directories, "unsafe_path");
    verifyFiles(context.files, "unsafe_path");
    return { beans, bytes: indexBytes(beans), status: "projected" };
}
export function checkIndex({ root }) {
    try {
        const context = createContext(root);
        const beans = scanBeans(context);
        const projected = indexBytes(beans);
        const indexPath = resolve(context.roasteryRoot, "index.json");
        safeChild(context.root, indexPath);
        if (readVerifiedFile(indexPath, context.directories, context.files, "unsafe_path").toString("utf8") !== projected) {
            fail("stale_index");
        }
        verifyDirectories(context.directories, "unsafe_path");
        verifyFiles(context.files, "unsafe_path");
        return { beans: beans.length, status: "valid" };
    }
    catch (error) {
        return invalidResult(error);
    }
}
export function validate({ root, mode, expectedContract, }) {
    try {
        const requestedMode = validationMode(mode);
        const context = createContext(root);
        const manifestPath = resolve(context.roasteryRoot, "roastery.json");
        safeChild(context.root, manifestPath);
        const manifest = readJson(manifestPath, context.directories, context.files, ["contract", "repository"], "invalid_roastery").document;
        const repository = normalizeRepository(manifest.repository);
        const actualContract = contractPin(manifest.contract);
        const trustedContract = contractPin(expectedContract);
        if (actualContract.repository !== trustedContract.repository ||
            actualContract.commit !== trustedContract.commit ||
            actualContract.digest !== trustedContract.digest) {
            fail("contract_mismatch");
        }
        const beans = scanBeans(context);
        const indexPath = resolve(context.roasteryRoot, "index.json");
        safeChild(context.root, indexPath);
        const index = readJson(indexPath, context.directories, context.files, ["beans"], "invalid_index");
        if (!Array.isArray(index.document.beans) ||
            index.source !== indexBytes(beans)) {
            fail("stale_index");
        }
        const licensePath = resolve(context.roasteryRoot, "CONTENT_LICENSE.md");
        const licenseEntry = lstatSync(licensePath, { throwIfNoEntry: false });
        if (licenseEntry !== undefined &&
            (!licenseEntry.isFile() || licenseEntry.isSymbolicLink())) {
            fail("unsafe_path");
        }
        if (licenseEntry !== undefined)
            safeChild(context.root, licensePath);
        const effectiveMode = requestedMode ??
            (repository === OFFICIAL_REPOSITORY ? "seed" : "initialized");
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
            parseContentLicense(decodeUtf8(readVerifiedFile(licensePath, context.directories, context.files, "unsafe_path"), "invalid_content_license"));
        }
        verifyDirectories(context.directories, "unsafe_path");
        verifyFiles(context.files, "unsafe_path");
        return { beanCount: beans.length, repository, status: "valid" };
    }
    catch (error) {
        return invalidResult(error);
    }
}
