import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { basename, relative, resolve, sep } from "node:path";

import { ContentLicenseError, parseContentLicense } from "./content-license.js";
import {
  captureDirectory,
  readVerifiedFile,
  UnsafeReadError,
  verifyDirectories,
  type DirectoryIdentity,
} from "./verified-read.js";

const OFFICIAL_REPOSITORY =
  "https://github.com/openboa-ai/coffee-chat-roastery" as const;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const URL_FORBIDDEN_SYNTAX = /[\\\s\u0000-\u001f\u007f-\u009f]/u;
const URI_MALFORMED_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/u;
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

export interface ContractPin {
  commit: string;
  digest: `sha256:${string}`;
  repository: typeof OFFICIAL_REPOSITORY;
}

export interface IndexEntry {
  digest: `sha256:${string}`;
  id: string;
}

export type ValidationMode = "seed" | "initialized";

export type ValidationResult =
  | { beanCount: number; repository: string; status: "valid" }
  | { code: string; status: "invalid" };

export interface ProjectIndexResult {
  beans: IndexEntry[];
  bytes: string;
  status: "projected";
}

export type IndexCheckResult =
  { beans: number; status: "valid" } | { code: string; status: "invalid" };

class ValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ValidationError(code);
}

function invalidResult(error: unknown): { code: string; status: "invalid" } {
  if (
    error instanceof ContentLicenseError ||
    error instanceof ValidationError ||
    error instanceof UnsafeReadError
  ) {
    return { code: error.code, status: "invalid" };
  }
  return { code: "invalid_roastery", status: "invalid" };
}

function object(
  value: unknown,
  keys: string[],
  code: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(code);
  }
  return value as Record<string, unknown>;
}

function readJson(
  path: string,
  directories: DirectoryIdentity[],
  keys: string[],
  code: string,
): { document: Record<string, unknown>; source: string } {
  let source: string;
  let parsed: unknown;
  try {
    source = readVerifiedFile(path, directories, "unsafe_path").toString(
      "utf8",
    );
    parsed = JSON.parse(source);
  } catch (error) {
    if (error instanceof UnsafeReadError) throw error;
    fail(code);
  }
  const result = object(parsed, keys, code);
  if (source !== `${JSON.stringify(parsed, null, 2)}\n`) fail(code);
  return { document: result, source };
}

function normalizeRepository(value: unknown): string {
  if (typeof value !== "string" || URL_FORBIDDEN_SYNTAX.test(value)) {
    fail("invalid_repository_identity");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("invalid_repository_identity");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    parts.length !== 2 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(parts[0] ?? "") ||
    !/^[A-Za-z0-9._-]+$/u.test(parts[1] ?? "") ||
    parts[1]?.endsWith(".git")
  ) {
    fail("invalid_repository_identity");
  }
  const normalized = `https://github.com/${parts[0]}/${parts[1]}`;
  if (value !== normalized) fail("invalid_repository_identity");
  return normalized;
}

function contractPin(value: unknown): ContractPin {
  const pin = object(
    value,
    ["commit", "digest", "repository"],
    "contract_mismatch",
  );
  if (
    pin.repository !== OFFICIAL_REPOSITORY ||
    typeof pin.commit !== "string" ||
    !SHA.test(pin.commit) ||
    typeof pin.digest !== "string" ||
    !DIGEST.test(pin.digest)
  ) {
    fail("contract_mismatch");
  }
  return pin as unknown as ContractPin;
}

function safeChild(root: string, path: string): void {
  const lexicalRoot = resolve(root);
  const candidate = resolve(path);
  const child = relative(lexicalRoot, candidate);
  if (
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    resolve(lexicalRoot, child) !== candidate
  ) {
    fail("unsafe_path");
  }
  let cursor = lexicalRoot;
  for (const segment of child.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) fail("unsafe_path");
  }
  const canonicalRoot = realpathSync(lexicalRoot);
  const canonicalCandidate = realpathSync(candidate);
  if (
    canonicalCandidate !== canonicalRoot &&
    !canonicalCandidate.startsWith(`${canonicalRoot}${sep}`)
  ) {
    fail("unsafe_path");
  }
}

function publicOrigin(value: string): boolean {
  if (
    URL_FORBIDDEN_SYNTAX.test(value) ||
    URI_MALFORMED_PERCENT_ESCAPE.test(value)
  )
    return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const parsedHost = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const host = parsedHost.replace(/\.$/u, "");
  if (
    url.href !== value ||
    parsedHost !== host ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }
  const labels = host.split(".");
  return (
    isIP(host) === 0 &&
    host.length <= 253 &&
    labels.length >= 2 &&
    !SPECIAL_USE_DNS_TLDS.has(labels.at(-1) ?? "") &&
    labels.every((label) =>
      /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/u.test(label),
    )
  );
}

function parseBean(
  path: string,
  directories: DirectoryIdentity[],
): { content: Buffer; id: string } {
  const content = readVerifiedFile(path, directories, "unsafe_path");
  const source = content.toString("utf8");
  if (!source.startsWith("---\n")) fail("invalid_bean");
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) fail("invalid_bean");
  const header = source.slice(4, end).split("\n");
  const body = source.slice(end + 5);
  const idLine = header.shift();
  if (!idLine?.startsWith("id: ")) fail("invalid_bean");
  const id = idLine.slice(4);
  if (!UUID_V7.test(id)) fail("invalid_bean_id");
  if (header.length > 0) {
    if (header.shift() !== "origins:" || header.length === 0)
      fail("invalid_bean");
    const origins = new Set<string>();
    for (const line of header) {
      const origin = line.slice(4);
      if (
        !line.startsWith("  - ") ||
        origin.trim() !== origin ||
        !publicOrigin(origin)
      ) {
        fail("invalid_origin");
      }
      if (origins.has(origin)) fail("duplicate_origin");
      origins.add(origin);
    }
  }
  if (body.trim().length === 0) fail("invalid_bean");
  if (basename(path) !== `${id}.md`) fail("invalid_bean_path");
  return { content, id };
}

interface RoasteryContext {
  directories: DirectoryIdentity[];
  roasteryRoot: string;
  root: string;
}

function createContext(root: string): RoasteryContext {
  const repositoryRoot = resolve(root);
  const repository = captureDirectory(repositoryRoot, [], "unsafe_path");
  const roasteryRoot = resolve(repositoryRoot, "roastery");
  safeChild(repositoryRoot, roasteryRoot);
  const roastery = captureDirectory(roasteryRoot, [repository], "unsafe_path");
  return {
    directories: [repository, roastery],
    roasteryRoot,
    root: repositoryRoot,
  };
}

function scanBeans(context: RoasteryContext): IndexEntry[] {
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
  const beansDirectory = captureDirectory(
    directory,
    context.directories,
    "unsafe_path",
  );
  const directories = [...context.directories, beansDirectory];
  const ids = new Set<string>();
  const entries = readdirSync(directory, { withFileTypes: true });
  const beans: IndexEntry[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("unsafe_path");
    safeChild(context.root, path);
    if (!entry.name.endsWith(".md")) fail("invalid_bean_path");
    const bean = parseBean(path, directories);
    if (ids.has(bean.id)) fail("duplicate_bean_id");
    ids.add(bean.id);
    beans.push({
      id: bean.id,
      digest: `sha256:${createHash("sha256").update(bean.content).digest("hex")}`,
    });
  }
  verifyDirectories(directories, "unsafe_path");
  return beans.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function indexBytes(beans: IndexEntry[]): string {
  return `${JSON.stringify({ beans }, null, 2)}\n`;
}

export function projectIndex({ root }: { root: string }): ProjectIndexResult {
  const context = createContext(root);
  const beans = scanBeans(context);
  verifyDirectories(context.directories, "unsafe_path");
  return { beans, bytes: indexBytes(beans), status: "projected" };
}

export function checkIndex({ root }: { root: string }): IndexCheckResult {
  try {
    const context = createContext(root);
    const beans = scanBeans(context);
    const projected = indexBytes(beans);
    const indexPath = resolve(context.roasteryRoot, "index.json");
    safeChild(context.root, indexPath);
    if (
      readVerifiedFile(indexPath, context.directories, "unsafe_path").toString(
        "utf8",
      ) !== projected
    ) {
      fail("stale_index");
    }
    verifyDirectories(context.directories, "unsafe_path");
    return { beans: beans.length, status: "valid" };
  } catch (error) {
    return invalidResult(error);
  }
}

export function validate({
  root,
  mode,
  expectedContract,
}: {
  root: string;
  mode?: ValidationMode;
  expectedContract: ContractPin;
}): ValidationResult {
  try {
    const context = createContext(root);
    const manifestPath = resolve(context.roasteryRoot, "roastery.json");
    safeChild(context.root, manifestPath);
    const manifest = readJson(
      manifestPath,
      context.directories,
      ["contract", "repository"],
      "invalid_roastery",
    ).document;
    const repository = normalizeRepository(manifest.repository);
    const actualContract = contractPin(manifest.contract);
    const trustedContract = contractPin(expectedContract);
    if (
      actualContract.repository !== trustedContract.repository ||
      actualContract.commit !== trustedContract.commit ||
      actualContract.digest !== trustedContract.digest
    ) {
      fail("contract_mismatch");
    }
    const beans = scanBeans(context);
    const indexPath = resolve(context.roasteryRoot, "index.json");
    safeChild(context.root, indexPath);
    const index = readJson(
      indexPath,
      context.directories,
      ["beans"],
      "invalid_index",
    );
    if (
      !Array.isArray(index.document.beans) ||
      index.source !== indexBytes(beans)
    ) {
      fail("stale_index");
    }

    const licensePath = resolve(context.roasteryRoot, "CONTENT_LICENSE.md");
    const licenseEntry = lstatSync(licensePath, { throwIfNoEntry: false });
    if (
      licenseEntry !== undefined &&
      (!licenseEntry.isFile() || licenseEntry.isSymbolicLink())
    ) {
      fail("unsafe_path");
    }
    if (licenseEntry !== undefined) safeChild(context.root, licensePath);
    const effectiveMode =
      mode ?? (repository === OFFICIAL_REPOSITORY ? "seed" : "initialized");
    if (effectiveMode === "seed") {
      if (
        repository !== OFFICIAL_REPOSITORY ||
        beans.length !== 0 ||
        licenseEntry !== undefined
      ) {
        fail("invalid_seed");
      }
    } else {
      if (
        repository === OFFICIAL_REPOSITORY ||
        !repository.endsWith("/coffee-chat")
      ) {
        fail("invalid_repository_identity");
      }
      if (licenseEntry === undefined) fail("invalid_content_license");
      parseContentLicense(
        readVerifiedFile(
          licensePath,
          context.directories,
          "unsafe_path",
        ).toString("utf8"),
      );
    }
    verifyDirectories(context.directories, "unsafe_path");
    return { beanCount: beans.length, repository, status: "valid" };
  } catch (error) {
    return invalidResult(error);
  }
}
