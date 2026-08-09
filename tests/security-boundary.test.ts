import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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
const beanId = "01890f3a-2b00-7000-8000-000000000001";

function temporaryRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "roastery-security-"));
  temporaryRoots.push(root);
  copyDeclaredBundle(repositoryRoot, root);
  mkdirSync(join(root, "roastery", "beans"), { recursive: true });
  return root;
}

function copyDeclaredBundle(sourceRoot: string, destinationRoot: string): void {
  const contract = JSON.parse(
    readFileSync(join(sourceRoot, "contract", "contract.json"), "utf8"),
  ) as { files: Record<string, string> };
  for (const path of [
    "contract/contract.json",
    ...Object.values(contract.files),
  ]) {
    mkdirSync(resolve(destinationRoot, path, ".."), { recursive: true });
    cpSync(resolve(sourceRoot, path), resolve(destinationRoot, path));
  }
}

function packageCommit(root = repositoryRoot): string {
  const packageDocument = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  ) as { gitHead?: string };
  return (
    packageDocument.gitHead ??
    execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim()
  );
}

function runCli(
  arguments_: string[],
  executable = cliPath,
  cwd = repositoryRoot,
) {
  return spawnSync(
    process.execPath,
    [realpathSync(executable), ...arguments_],
    {
      cwd: realpathSync(cwd),
      encoding: "utf8",
    },
  );
}

function validateCommand(
  root: string,
  contract?: { commit: string; digest: string },
): string[] {
  return contract === undefined
    ? ["validate", "--root", root, "--format", "json"]
    : [
        "validate",
        "--root",
        root,
        "--contract-commit",
        contract.commit,
        "--contract-digest",
        contract.digest,
        "--format",
        "json",
      ];
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

async function initializeEmptyRepository(
  root: string,
  commit = packageCommit(),
): Promise<string> {
  const { digestContractBundle } = await import("../src/contract/digest.js");
  const digest = await digestContractBundle(root);
  writeFileSync(
    join(root, "roastery", "roastery.json"),
    `${JSON.stringify(
      {
        repository: "https://github.com/fixture-owner/fixture-roastery",
        contract: {
          repository: "https://github.com/openboa-ai/coffee-chat-roastery",
          commit,
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

async function initializeBeanRepository(
  root: string,
  commit = packageCommit(),
): Promise<string> {
  const digest = await initializeEmptyRepository(root, commit);
  const { renderContentLicense } =
    await import("../src/projection/content-license.js");
  const beanBytes = `---\nid: ${beanId}\norigins:\n  - https://example.com/source\n---\nBody.\n`;
  writeFileSync(
    join(root, "roastery", "CONTENT_LICENSE.md"),
    renderContentLicense({
      scope: "roastery/beans/**",
      license: "CC-BY-4.0",
      attribution: "Fixture Owner",
    }),
  );
  writeFileSync(join(root, "roastery", "beans", `${beanId}.md`), beanBytes);
  writeFileSync(
    join(root, "roastery", "index.json"),
    `${JSON.stringify(
      {
        beans: [
          {
            id: beanId,
            content_digest: `sha256:${createHash("sha256")
              .update(beanBytes)
              .digest("hex")}`,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return digest;
}

function copiedInstalledPackage(): string {
  const root = mkdtempSync(join(tmpdir(), "roastery-installed-package-"));
  temporaryRoots.push(root);
  cpSync(
    resolve(repositoryRoot, "package.json"),
    resolve(root, "package.json"),
  );
  cpSync(resolve(repositoryRoot, "src"), resolve(root, "src"), {
    recursive: true,
  });
  cpSync(resolve(repositoryRoot, "dist"), resolve(root, "dist"), {
    recursive: true,
  });
  cpSync(resolve(repositoryRoot, "contract"), resolve(root, "contract"), {
    recursive: true,
  });
  symlinkSync(
    resolve(repositoryRoot, "node_modules"),
    resolve(root, "node_modules"),
    "dir",
  );
  return root;
}

function installedPackage(schemaKey: string): string {
  const root = copiedInstalledPackage();

  const contract = JSON.parse(
    readFileSync(resolve(root, "contract/contract.json"), "utf8"),
  ) as { files: Record<string, string> };
  const schemaPath = resolve(root, contract.files[schemaKey] as string);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    properties: Record<string, Record<string, unknown>>;
  };
  if (schemaKey === "roastery_schema") {
    schema.properties.repository = {
      const: "https://github.com/schema-owner/schema-roastery",
    };
  } else if (schemaKey === "index_schema") {
    const beans = schema.properties.beans;
    if (beans === undefined) throw new Error("index schema has no beans field");
    beans.maxItems = 0;
  } else if (schemaKey === "bean_frontmatter_schema") {
    schema.properties.id = { const: "01890f3a-2b00-7000-8000-000000000002" };
  } else {
    schema.properties.attribution = { const: "Schema Owner" };
  }
  writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("local CLI boundary", () => {
  test("validates from an installed package with an explicit official contract pin", async () => {
    const packageRoot = copiedInstalledPackage();
    const root = temporaryRepository();
    const commit = "3".repeat(40);
    const digest = await initializeEmptyRepository(root, commit);

    const result = runCli(
      validateCommand(root, { commit, digest }),
      resolve(packageRoot, "dist/cli.js"),
      packageRoot,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "valid",
      contract: { commit, digest },
    });
  });

  test("rejects a repository that self-authorizes a replacement contract bundle", async () => {
    const root = temporaryRepository();
    const trustedDigest = await initializeEmptyRepository(root);
    writeFileSync(
      join(root, "contract", "publication.md"),
      "attacker-controlled replacement contract\n",
    );
    const { digestContractBundle } = await import("../src/contract/digest.js");
    const replacementDigest = await digestContractBundle(root);
    writeFileSync(
      join(root, "roastery", "roastery.json"),
      `${JSON.stringify(
        {
          repository: "https://github.com/fixture-owner/fixture-roastery",
          contract: {
            repository: "https://github.com/openboa-ai/coffee-chat-roastery",
            commit: "2".repeat(40),
            digest: replacementDigest,
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = runCli(validateCommand(root));

    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "invalid",
      reason: "contract_mismatch",
    });
    expect(trustedDigest).not.toBe(replacementDigest);
  });

  test.each([
    "roastery_schema",
    "index_schema",
    "bean_frontmatter_schema",
    "content_license_schema",
  ])("applies the vendored %s to parsed repository data", async (schemaKey) => {
    const packageRoot = installedPackage(schemaKey);
    const root = mkdtempSync(join(tmpdir(), "roastery-schema-consumer-"));
    temporaryRoots.push(root);
    copyDeclaredBundle(packageRoot, root);
    mkdirSync(join(root, "roastery", "beans"), { recursive: true });
    const commit = "3".repeat(40);
    const { digestContractBundle } = await import("../src/contract/digest.js");
    const digest = await digestContractBundle(packageRoot);
    await initializeBeanRepository(root, commit);

    const result = runCli(
      validateCommand(root, { commit, digest }),
      resolve(packageRoot, "dist/cli.js"),
      packageRoot,
    );

    expect(
      result.status,
      `${schemaKey}: ${result.stdout}\n${result.stderr}`,
    ).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "invalid" });
  });

  test("exposes only validate, project-index, and contract-digest with structured statuses", async () => {
    const root = temporaryRepository();
    const digest = await initializeEmptyRepository(root);

    const validate = runCli(validateCommand(root));
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

describe("canonical repository validation", () => {
  test.each([
    {
      name: "maximum HTTPS port",
      origin: "https://example.com:65535/source",
      duplicateIndexEntry: false,
      expected: { status: "valid" },
    },
    {
      name: "out-of-range HTTPS port",
      origin: "https://example.com:65536/source",
      duplicateIndexEntry: false,
      expected: { status: "invalid", reason: "invalid_bean" },
    },
    {
      name: "duplicate Bean ID",
      origin: "https://example.com/source",
      duplicateIndexEntry: true,
      expected: { status: "invalid", reason: "duplicate_bean_id" },
    },
  ])("handles $name at the repository boundary", async (scenario) => {
    const root = temporaryRepository();
    await initializeEmptyRepository(root);
    const { renderContentLicense } =
      await import("../src/projection/content-license.js");
    const beanBytes = `---\nid: ${beanId}\norigins:\n  - ${scenario.origin}\n---\nBody.\n`;
    const entry = {
      id: beanId,
      content_digest: `sha256:${createHash("sha256").update(beanBytes).digest("hex")}`,
    };
    writeFileSync(
      join(root, "roastery", "CONTENT_LICENSE.md"),
      renderContentLicense({
        scope: "roastery/beans/**",
        license: "CC-BY-4.0",
        attribution: "Fixture Owner",
      }),
    );
    writeFileSync(join(root, "roastery", "beans", `${beanId}.md`), beanBytes);
    writeFileSync(
      join(root, "roastery", "index.json"),
      `${JSON.stringify(
        { beans: scenario.duplicateIndexEntry ? [entry, entry] : [entry] },
        null,
        2,
      )}\n`,
    );
    const { validateRepository } =
      await import("../src/validation/repository.js");

    await expect(validateRepository(root)).resolves.toMatchObject(
      scenario.expected,
    );
  });
});

describe("filesystem trust boundary", () => {
  test("reports a missing Roastery as missing evidence instead of an unsafe path", async () => {
    const root = temporaryRepository();
    rmSync(join(root, "roastery"), { recursive: true });
    const { validateRepository } =
      await import("../src/validation/repository.js");

    const result = await validateRepository(root, {
      repository: "https://github.com/openboa-ai/coffee-chat-roastery",
      commit: "1".repeat(40),
      digest: `sha256:${"0".repeat(64)}`,
    });

    expect(result).toEqual({
      status: "invalid",
      reason: "missing_roastery",
    });
  });

  test("rejects a symlinked selected root in every validation and projection mode", async () => {
    const targetRoot = temporaryRepository();
    await initializeEmptyRepository(targetRoot);
    const linkParent = mkdtempSync(join(tmpdir(), "roastery-linked-root-"));
    temporaryRoots.push(linkParent);
    const linkedRoot = join(linkParent, "selected");
    symlinkSync(targetRoot, linkedRoot, "dir");
    const before = treeDigest(targetRoot);

    for (const selectedRoot of [linkedRoot, `${linkedRoot}/.`]) {
      for (const command of [
        validateCommand(selectedRoot),
        ["contract-digest", "--root", selectedRoot, "--format", "json"],
        ["project-index", "--root", selectedRoot, "--check"],
        ["project-index", "--root", selectedRoot],
      ]) {
        const result = runCli(command);
        expect(result.status, command.join(" ")).not.toBe(0);
        expect(JSON.parse(result.stdout), command.join(" ")).toMatchObject({
          status: "invalid",
          reason: "unsafe_repository_path",
        });
      }
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

    const result = runCli(validateCommand(root));

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
