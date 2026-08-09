import { TextDecoder } from "node:util";
import { isIP } from "node:net";

import type { Bean } from "../contract/types.ts";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BEAN_PATH =
  /^roastery\/beans\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export type BeanValidationResult =
  { status: "valid"; bean: Bean } | { status: "invalid"; reason: string };

export function isLowercaseUuidV7(value: string): boolean {
  return UUID_V7.test(value);
}

const SPECIAL_HOST_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "invalid",
  "test",
  "example",
  "home.arpa",
  "onion",
] as const;

function isPublicHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    const addressLiteral = hostname.replace(/^\[|\]$/gu, "");
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      isIP(addressLiteral) !== 0 ||
      !hostname.includes(".") ||
      SPECIAL_HOST_SUFFIXES.some(
        (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
      )
    ) {
      return false;
    }
    return hostname.length > 0;
  } catch {
    return false;
  }
}

export function validateBeanFile(
  relativePath: string,
  bytes: Uint8Array,
): BeanValidationResult {
  const pathMatch = BEAN_PATH.exec(relativePath);
  if (!pathMatch) return { status: "invalid", reason: "invalid_bean_path" };

  let source: string;
  try {
    source = utf8.decode(bytes);
  } catch {
    return { status: "invalid", reason: "invalid_bean_utf8" };
  }
  if (source.includes("\r") || !source.startsWith("---\n")) {
    return { status: "invalid", reason: "invalid_bean_frontmatter" };
  }
  const boundary = source.indexOf("\n---\n", 4);
  if (boundary < 0) {
    return { status: "invalid", reason: "invalid_bean_frontmatter" };
  }
  const frontmatterLines = source.slice(4, boundary).split("\n");
  const idMatch = /^id: ([0-9a-f-]+)$/u.exec(frontmatterLines[0] ?? "");
  if (!idMatch || !isLowercaseUuidV7(idMatch[1] ?? "")) {
    return { status: "invalid", reason: "invalid_bean_frontmatter" };
  }
  const id = idMatch[1] as string;
  if (id !== pathMatch[1]) {
    return { status: "invalid", reason: "bean_id_path_mismatch" };
  }

  let origins: string[] | undefined;
  if (frontmatterLines.length > 1) {
    if (frontmatterLines[1] !== "origins:" || frontmatterLines.length < 3) {
      return { status: "invalid", reason: "invalid_bean_frontmatter" };
    }
    origins = [];
    for (const line of frontmatterLines.slice(2)) {
      const originMatch = /^  - (\S.*)$/u.exec(line);
      if (!originMatch || !isPublicHttpsOrigin(originMatch[1] ?? "")) {
        return { status: "invalid", reason: "invalid_origin" };
      }
      origins.push(originMatch[1] as string);
    }
    if (new Set(origins).size !== origins.length) {
      return { status: "invalid", reason: "invalid_origin" };
    }
  }

  const body = source.slice(boundary + 5);
  if (body.trim().length === 0) {
    return { status: "invalid", reason: "empty_bean_body" };
  }
  return {
    status: "valid",
    bean: origins === undefined ? { id, body } : { id, origins, body },
  };
}
