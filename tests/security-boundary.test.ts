import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const temporaryRoots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "..");
const cliPath = resolve(repositoryRoot, "src/cli.ts");

function temporaryRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "roastery-security-"));
  temporaryRoots.push(root);
  cpSync(resolve(repositoryRoot, "contract"), join(root, "contract"), {
    recursive: true,
  });
  mkdirSync(join(root, "roastery", "beans"), { recursive: true });
  return root;
}

function runCli(arguments_: string[]) {
  return spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function treeDigest(root: string): string {
  const hash = createHash("sha256");
  function visit(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const metadata = lstatSync(path);
      const relativePath = relative(root, path);
      hash.update(relativePath);
      hash.update(metadata.isSymbolicLink() ? "symlink" : "regular");
      if (metadata.isDirectory()) visit(path);
      else if (metadata.isSymbolicLink()) hash.update(readFileSync(path));
      else hash.update(readFileSync(path));
    }
  }
  visit(root);
  return hash.digest("hex");
}

async function initializeEmptyRepository(root: string): Promise<string> {
  const { digestContractBundle } = await import("../src/contract/digest.js");
  const digest = await digestContractBundle(root);
  writeFileSync(
    join(root, "roastery", "roastery.json"),
    `${JSON.stringify(
      {
        repository: "https://github.com/fixture-owner/fixture-roastery",
        contract: {
          repository: "https://github.com/openboa-ai/coffee-chat-roastery",
          commit: "1".repeat(40),
          digest,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "roastery", "index.json"),
    `${JSON.stringify({ beans: [] }, null, 2)}\n`,
  );
  return digest;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("local CLI boundary", () => {
  test("exposes only validate, project-index, and contract-digest with structured statuses", async () => {
    const root = temporaryRepository();
    const digest = await initializeEmptyRepository(root);

    const validate = runCli(["validate", "--root", root, "--format", "json"]);
    expect(validate.status, validate.stderr).toBe(0);
    expect(JSON.parse(validate.stdout)).toMatchObject({
      status: "valid",
      bean_count: 0,
    });

    const contractDigest = runCli([
      "contract-digest",
      "--root",
      root,
      "--format",
      "json",
    ]);
    expect(contractDigest.status, contractDigest.stderr).toBe(0);
    expect(JSON.parse(contractDigest.stdout)).toEqual({
      status: "valid",
      digest,
    });

    const projectCheck = runCli(["project-index", "--root", root, "--check"]);
    expect(projectCheck.status, projectCheck.stderr).toBe(0);
    expect(JSON.parse(projectCheck.stdout)).toEqual({
      status: "valid",
      path: "roastery/index.json",
    });
  });

  test("all read-only and invalid commands leave repository bytes unchanged", async () => {
    const root = temporaryRepository();
    await initializeEmptyRepository(root);
    const before = treeDigest(root);

    const commands = [
      ["validate", "--root", root, "--format", "json"],
      ["contract-digest", "--root", root, "--format", "json"],
      ["project-index", "--root", root, "--check"],
      ["unknown", "--root", root],
      ["validate", "--root", root, "--format", "text"],
    ];
    for (const command of commands) runCli(command);

    expect(treeDigest(root)).toBe(before);
  });

  test("project-index without --check is the only command that writes", async () => {
    const root = temporaryRepository();
    await initializeEmptyRepository(root);
    writeFileSync(join(root, "roastery", "index.json"), "stale\n");
    const before = treeDigest(root);

    const result = runCli(["project-index", "--root", root]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "projected",
      path: "roastery/index.json",
    });
    expect(readFileSync(join(root, "roastery", "index.json"), "utf8")).toBe(
      `${JSON.stringify({ beans: [] }, null, 2)}\n`,
    );
    expect(treeDigest(root)).not.toBe(before);
  });
});

describe("filesystem trust boundary", () => {
  test("rejects a symlinked selected root in every validation and projection mode", async () => {
    const targetRoot = temporaryRepository();
    await initializeEmptyRepository(targetRoot);
    const linkParent = mkdtempSync(join(tmpdir(), "roastery-linked-root-"));
    temporaryRoots.push(linkParent);
    const linkedRoot = join(linkParent, "selected");
    symlinkSync(targetRoot, linkedRoot, "dir");
    const before = treeDigest(targetRoot);

    for (const command of [
      ["validate", "--root", linkedRoot, "--format", "json"],
      ["contract-digest", "--root", linkedRoot, "--format", "json"],
      ["project-index", "--root", linkedRoot, "--check"],
      ["project-index", "--root", linkedRoot],
    ]) {
      const result = runCli(command);
      expect(result.status, command.join(" ")).not.toBe(0);
      expect(JSON.parse(result.stdout), command.join(" ")).toMatchObject({
        status: "invalid",
        reason: "unsafe_repository_path",
      });
    }
    expect(treeDigest(targetRoot)).toBe(before);
  });

  test("rejects a symlinked beans directory in check and write modes", async () => {
    const root = temporaryRepository();
    await initializeEmptyRepository(root);
    const outsideRoot = mkdtempSync(join(tmpdir(), "roastery-outside-beans-"));
    temporaryRoots.push(outsideRoot);
    const beanName = "01890f3a-2b00-7000-8000-000000000001.md";
    const outsideBean = join(outsideRoot, beanName);
    const outsideBytes = `---\nid: ${beanName.slice(0, -3)}\n---\nOutside body.\n`;
    writeFileSync(outsideBean, outsideBytes);
    rmSync(join(root, "roastery", "beans"), { recursive: true });
    symlinkSync(outsideRoot, join(root, "roastery", "beans"), "dir");

    for (const command of [
      ["project-index", "--root", root, "--check"],
      ["project-index", "--root", root],
    ]) {
      const result = runCli(command);
      expect(result.status, command.join(" ")).not.toBe(0);
      expect(JSON.parse(result.stdout), command.join(" ")).toMatchObject({
        status: "invalid",
        reason: "unsafe_repository_path",
      });
    }
    expect(readFileSync(outsideBean, "utf8")).toBe(outsideBytes);
  });

  test("check mode rejects a linked index without reading its target", async () => {
    const root = temporaryRepository();
    await initializeEmptyRepository(root);
    const outsideRoot = mkdtempSync(
      join(tmpdir(), "roastery-outside-check-index-"),
    );
    temporaryRoots.push(outsideRoot);
    const outside = join(outsideRoot, "outside-index.json");
    const outsideBytes = `${JSON.stringify({ beans: [] }, null, 2)}\n`;
    writeFileSync(outside, outsideBytes);
    rmSync(join(root, "roastery", "index.json"));
    symlinkSync(outside, join(root, "roastery", "index.json"));

    const result = runCli(["project-index", "--root", root, "--check"]);

    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "invalid",
      reason: "unsafe_repository_path",
    });
    expect(readFileSync(outside, "utf8")).toBe(outsideBytes);
  });

  test("rejects a Bean symlink that escapes the repository root", async () => {
    const root = temporaryRepository();
    await initializeEmptyRepository(root);
    const outsideRoot = mkdtempSync(join(tmpdir(), "roastery-outside-bean-"));
    temporaryRoots.push(outsideRoot);
    const outside = join(outsideRoot, "outside-bean.md");
    writeFileSync(outside, "outside stays unchanged\n");
    symlinkSync(
      outside,
      join(
        root,
        "roastery",
        "beans",
        "01890f3a-2b00-7000-8000-000000000001.md",
      ),
    );
    const before = readFileSync(outside, "utf8");

    const result = runCli(["validate", "--root", root, "--format", "json"]);

    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "invalid",
      reason: "unsafe_repository_path",
    });
    expect(readFileSync(outside, "utf8")).toBe(before);
  });

  test("rejects an index symlink instead of overwriting its target", async () => {
    const root = temporaryRepository();
    await initializeEmptyRepository(root);
    const outsideRoot = mkdtempSync(join(tmpdir(), "roastery-outside-index-"));
    temporaryRoots.push(outsideRoot);
    const outside = join(outsideRoot, "outside-index.json");
    writeFileSync(outside, "outside stays unchanged\n");
    rmSync(join(root, "roastery", "index.json"));
    symlinkSync(outside, join(root, "roastery", "index.json"));

    const result = runCli(["project-index", "--root", root]);

    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "invalid",
      reason: "unsafe_index_path",
    });
    expect(readFileSync(outside, "utf8")).toBe("outside stays unchanged\n");
  });
});
