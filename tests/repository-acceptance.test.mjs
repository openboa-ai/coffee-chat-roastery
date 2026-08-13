import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkIndex,
  projectIndex,
  renderContentLicense,
  validate,
} from "../dist/index.js";

/** @type {import("../dist/index.js").ContractPin} */
const contract = {
  repository: "https://github.com/openboa-ai/coffee-chat-roastery",
  commit: "a".repeat(40),
  digest: `sha256:${"b".repeat(64)}`,
};
const MAX_ROASTERY_JSON_BYTES = 64 * 1024;
const MAX_INDEX_BYTES = 256 * 1024;
const MAX_CONTENT_LICENSE_BYTES = 8 * 1024;
const MAX_BEAN_BYTES = 256 * 1024;
const MAX_BEANS = 1024;
const MAX_TOTAL_BEAN_BYTES = 8 * 1024 * 1024;
const MAX_ORIGINS_PER_BEAN = 64;

function beanId(index) {
  return `00000000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`;
}

/**
 * @param {number} index
 * @param {{ origins?: number; size?: number }} [options]
 */
function beanBytes(index, { origins = 1, size } = {}) {
  const id = beanId(index);
  const originLines = Array.from(
    { length: origins },
    (_, origin) => `  - https://source${origin}.example.com/${index}`,
  ).join("\n");
  const prefix = `---\nid: ${id}\norigins:\n${originLines}\n---\n\n`;
  if (size === undefined) return `${prefix}Bean ${index}.\n`;
  const bodyBytes = size - Buffer.byteLength(prefix) - 1;
  assert.ok(bodyBytes >= 1, "test Bean size must leave a non-empty body");
  return `${prefix}${"x".repeat(bodyBytes)}\n`;
}

function fixture({
  repository = "https://github.com/openboa-ai/coffee-chat-roastery",
  initialized = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "roastery-fixture-"));
  mkdirSync(join(root, "roastery"), { recursive: true });
  writeFileSync(
    join(root, "roastery", "roastery.json"),
    `${JSON.stringify(
      {
        repository,
        contract,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "roastery", "index.json"),
    `${JSON.stringify({ beans: [] }, null, 2)}\n`,
  );
  if (initialized) {
    writeFileSync(
      join(root, "roastery", "CONTENT_LICENSE.md"),
      renderContentLicense("Example Owner").content,
    );
  }
  return root;
}

test("one validator accepts the Bean-free seed and an initialized owner fork", () => {
  const seed = fixture();
  const danglingBeans = fixture();
  const owner = fixture({
    initialized: true,
    repository: "https://github.com/example/coffee-chat",
  });
  const invalidRepositories = [
    "https://github.com/exam\tple/coffee-chat",
    "https://github.com/example\\coffee-chat",
  ].map((repository) => fixture({ initialized: true, repository }));
  try {
    assert.deepEqual(
      validate({ root: seed, mode: "seed", expectedContract: contract }),
      {
        beanCount: 0,
        repository: "https://github.com/openboa-ai/coffee-chat-roastery",
        status: "valid",
      },
    );
    symlinkSync(
      join(danglingBeans, "missing-beans"),
      join(danglingBeans, "roastery", "beans"),
    );
    assert.deepEqual(
      validate({
        root: danglingBeans,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "unsafe_path", status: "invalid" },
    );
    unlinkSync(join(danglingBeans, "roastery", "beans"));
    unlinkSync(join(danglingBeans, "roastery", "roastery.json"));
    writeFileSync(
      join(danglingBeans, "roastery", "roastery.json"),
      `{
  "repository": "https://github.com/attacker/coffee-chat-roastery",
  "repository": "https://github.com/openboa-ai/coffee-chat-roastery",
  "contract": ${JSON.stringify(contract)}
}\n`,
    );
    assert.deepEqual(
      validate({
        root: danglingBeans,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "invalid_roastery", status: "invalid" },
    );
    writeFileSync(
      join(danglingBeans, "roastery", "roastery.json"),
      `${JSON.stringify(
        {
          repository: "https://github.com/openboa-ai/coffee-chat-roastery",
          contract,
        },
        null,
        2,
      )}\n`,
    );
    symlinkSync(
      join(danglingBeans, "missing-license"),
      join(danglingBeans, "roastery", "CONTENT_LICENSE.md"),
    );
    assert.deepEqual(
      validate({
        root: danglingBeans,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "unsafe_path", status: "invalid" },
    );
    unlinkSync(join(danglingBeans, "roastery", "CONTENT_LICENSE.md"));
    unlinkSync(join(danglingBeans, "roastery", "roastery.json"));
    symlinkSync("index.json", join(danglingBeans, "roastery", "roastery.json"));
    assert.deepEqual(
      validate({
        root: danglingBeans,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "unsafe_path", status: "invalid" },
    );
    assert.deepEqual(
      validate({
        root: owner,
        mode: "initialized",
        expectedContract: contract,
      }),
      {
        beanCount: 0,
        repository: "https://github.com/example/coffee-chat",
        status: "valid",
      },
    );
    for (const root of invalidRepositories) {
      assert.deepEqual(
        validate({
          root,
          mode: "initialized",
          expectedContract: contract,
        }),
        { code: "invalid_repository_identity", status: "invalid" },
      );
    }
    assert.deepEqual(
      validate({
        root: owner,
        mode: "initialized",
        expectedContract: { ...contract, digest: `sha256:${"c".repeat(64)}` },
      }),
      { code: "contract_mismatch", status: "invalid" },
    );
    const replacementLicense = Buffer.from(
      renderContentLicense("Owner �").content,
      "utf8",
    );
    writeFileSync(
      join(owner, "roastery", "CONTENT_LICENSE.md"),
      Buffer.from(
        replacementLicense.toString("hex").replaceAll("efbfbd", "ff"),
        "hex",
      ),
    );
    assert.deepEqual(
      validate({
        root: owner,
        mode: "initialized",
        expectedContract: contract,
      }),
      {
        code: "invalid_content_license",
        status: "invalid",
      },
    );
    rmSync(join(owner, "roastery", "CONTENT_LICENSE.md"));
    assert.deepEqual(
      validate({
        root: owner,
        mode: "initialized",
        expectedContract: contract,
      }),
      {
        code: "invalid_content_license",
        status: "invalid",
      },
    );
  } finally {
    rmSync(seed, { force: true, recursive: true });
    rmSync(danglingBeans, { force: true, recursive: true });
    rmSync(owner, { force: true, recursive: true });
    for (const root of invalidRepositories) {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

test("validation rejects an unknown explicit mode before reading a repository", () => {
  assert.deepEqual(
    validate({
      root: "/path/that/must/not/be-read",
      mode: JSON.parse('"bogus"'),
      expectedContract: contract,
    }),
    { code: "invalid_mode", status: "invalid" },
  );
});

test("validation bounds repository metadata and content-license bytes", () => {
  const manifestRoot = fixture();
  const indexRoot = fixture();
  const licenseRoot = fixture({
    initialized: true,
    repository: "https://github.com/example/coffee-chat",
  });
  try {
    writeFileSync(
      join(manifestRoot, "roastery", "roastery.json"),
      Buffer.alloc(MAX_ROASTERY_JSON_BYTES + 1, 0x61),
    );
    assert.deepEqual(
      validate({
        root: manifestRoot,
        mode: "seed",
        expectedContract: contract,
      }),
      { code: "resource_limit_exceeded", status: "invalid" },
    );

    writeFileSync(
      join(indexRoot, "roastery", "index.json"),
      Buffer.alloc(MAX_INDEX_BYTES + 1, 0x62),
    );
    assert.deepEqual(checkIndex({ root: indexRoot }), {
      code: "resource_limit_exceeded",
      status: "invalid",
    });

    writeFileSync(
      join(licenseRoot, "roastery", "CONTENT_LICENSE.md"),
      Buffer.alloc(MAX_CONTENT_LICENSE_BYTES + 1, 0x63),
    );
    assert.deepEqual(
      validate({
        root: licenseRoot,
        mode: "initialized",
        expectedContract: contract,
      }),
      { code: "resource_limit_exceeded", status: "invalid" },
    );
  } finally {
    rmSync(manifestRoot, { force: true, recursive: true });
    rmSync(indexRoot, { force: true, recursive: true });
    rmSync(licenseRoot, { force: true, recursive: true });
  }
});

test("Bean projection enforces per-file, origin, count, and aggregate budgets", () => {
  const perFileRoot = fixture();
  const originRoot = fixture();
  const countRoot = fixture();
  const aggregateRoot = fixture();
  for (const root of [perFileRoot, originRoot, countRoot, aggregateRoot]) {
    mkdirSync(join(root, "roastery", "beans"));
  }
  try {
    const perFilePath = join(
      perFileRoot,
      "roastery",
      "beans",
      `${beanId(1)}.md`,
    );
    writeFileSync(perFilePath, beanBytes(1, { size: MAX_BEAN_BYTES }));
    assert.equal(projectIndex({ root: perFileRoot }).beans.length, 1);
    writeFileSync(perFilePath, Buffer.alloc(MAX_BEAN_BYTES + 1, 0x64));
    assert.throws(
      () => projectIndex({ root: perFileRoot }),
      /resource_limit_exceeded/u,
    );

    const originPath = join(originRoot, "roastery", "beans", `${beanId(2)}.md`);
    writeFileSync(originPath, beanBytes(2, { origins: MAX_ORIGINS_PER_BEAN }));
    assert.equal(projectIndex({ root: originRoot }).beans.length, 1);
    writeFileSync(
      originPath,
      beanBytes(2, { origins: MAX_ORIGINS_PER_BEAN + 1 }),
    );
    assert.throws(
      () => projectIndex({ root: originRoot }),
      /resource_limit_exceeded/u,
    );

    const countDirectory = join(countRoot, "roastery", "beans");
    for (let index = 1; index <= MAX_BEANS; index += 1) {
      writeFileSync(
        join(countDirectory, `${beanId(index)}.md`),
        beanBytes(index),
      );
    }
    assert.equal(projectIndex({ root: countRoot }).beans.length, MAX_BEANS);
    writeFileSync(
      join(countDirectory, `${beanId(MAX_BEANS + 1)}.md`),
      beanBytes(MAX_BEANS + 1),
    );
    assert.throws(
      () => projectIndex({ root: countRoot }),
      /resource_limit_exceeded/u,
    );

    const aggregateDirectory = join(aggregateRoot, "roastery", "beans");
    const exactAggregateCount = MAX_TOTAL_BEAN_BYTES / MAX_BEAN_BYTES;
    for (let index = 1; index <= exactAggregateCount; index += 1) {
      writeFileSync(
        join(aggregateDirectory, `${beanId(index)}.md`),
        beanBytes(index, { size: MAX_BEAN_BYTES }),
      );
    }
    assert.equal(
      projectIndex({ root: aggregateRoot }).beans.length,
      exactAggregateCount,
    );
    writeFileSync(
      join(aggregateDirectory, `${beanId(exactAggregateCount + 1)}.md`),
      beanBytes(exactAggregateCount + 1),
    );
    assert.throws(
      () => projectIndex({ root: aggregateRoot }),
      /resource_limit_exceeded/u,
    );
  } finally {
    rmSync(perFileRoot, { force: true, recursive: true });
    rmSync(originRoot, { force: true, recursive: true });
    rmSync(countRoot, { force: true, recursive: true });
    rmSync(aggregateRoot, { force: true, recursive: true });
  }
});

test("projection is deterministic and validation rejects unsafe or stale Bean state", () => {
  const root = fixture({
    initialized: true,
    repository: "https://github.com/example/coffee-chat",
  });
  const external = mkdtempSync(join(tmpdir(), "roastery-external-"));
  const externalTarget = join(external, "must-not-change.txt");
  writeFileSync(externalTarget, "unchanged\n");
  mkdirSync(join(root, "roastery", "beans"));
  const id = "018f0f31-9d95-7c89-8f7a-9de83bb3f123";
  const bean = `---\nid: ${id}\norigins:\n  - https://example.com/source\n---\n\nA deliberate point of view.\n`;
  const beanPath = join(root, "roastery", "beans", `${id}.md`);
  writeFileSync(beanPath, bean);

  try {
    const originalIndex = readFileSync(
      join(root, "roastery", "index.json"),
      "utf8",
    );
    const projected = projectIndex({ root });
    const expectedDigest = `sha256:${createHash("sha256").update(bean).digest("hex")}`;
    const expectedIndex = `${JSON.stringify(
      { beans: [{ id, digest: expectedDigest }] },
      null,
      2,
    )}\n`;
    assert.deepEqual(projected, {
      beans: [{ digest: expectedDigest, id }],
      bytes: expectedIndex,
      status: "projected",
    });
    assert.equal(
      readFileSync(join(root, "roastery", "index.json"), "utf8"),
      originalIndex,
    );
    writeFileSync(join(root, "roastery", "index.json"), projected.bytes);
    assert.equal(
      validate({ root, mode: "initialized", expectedContract: contract })
        .status,
      "valid",
    );

    const outsideBean = join(external, `${id}.md`);
    writeFileSync(
      outsideBean,
      bean.replace("A deliberate point of view.", "Outside bytes."),
    );
    const originalRealpath = fs.realpathSync;
    let beanSwapped = false;
    Object.defineProperty(fs, "realpathSync", {
      configurable: true,
      value: function realpathAndSwap(path, options) {
        const resolved = originalRealpath.call(fs, path, options);
        if (!beanSwapped && String(path) === beanPath) {
          beanSwapped = true;
          fs.unlinkSync(beanPath);
          fs.symlinkSync(outsideBean, beanPath);
        }
        return resolved;
      },
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => projectIndex({ root }), /unsafe_path/u);
    } finally {
      Object.defineProperty(fs, "realpathSync", {
        configurable: true,
        value: originalRealpath,
      });
      syncBuiltinESMExports();
      fs.unlinkSync(beanPath);
      writeFileSync(beanPath, bean);
    }

    const indexPath = join(root, "roastery", "index.json");
    const originalLstat = fs.lstatSync;
    let beanModified = false;
    Object.defineProperty(fs, "lstatSync", {
      configurable: true,
      value: function lstatAndModifyBean(path, options) {
        const stat = originalLstat.call(fs, path, options);
        if (!beanModified && String(path) === indexPath) {
          beanModified = true;
          fs.writeFileSync(
            beanPath,
            bean.replace(
              "A deliberate point of view.",
              "Changed after Bean validation.",
            ),
          );
        }
        return stat;
      },
    });
    syncBuiltinESMExports();
    try {
      assert.deepEqual(
        validate({ root, mode: "initialized", expectedContract: contract }),
        { code: "unsafe_path", status: "invalid" },
      );
    } finally {
      Object.defineProperty(fs, "lstatSync", {
        configurable: true,
        value: originalLstat,
      });
      syncBuiltinESMExports();
      writeFileSync(beanPath, bean);
    }

    for (const unsafeOrigin of [
      "localhost",
      "localhost.",
      "printer.local.",
      ".",
      "foo..bar",
      "-bad.example",
      "bad-.example",
      "printer",
      "foo.test",
      "service.invalid",
      "router.home.arpa",
      "hidden.onion",
      "service.internal",
      "private.alt",
      "exam\tple.com",
      "example.com\\source",
      "EXAMPLE.com",
      "example.com:443",
      "example.com.",
      "127.0.0.1",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "[::]",
      "[::1]",
      "[::ffff:127.0.0.1]",
    ]) {
      writeFileSync(beanPath, bean.replace("example.com", unsafeOrigin));
      assert.deepEqual(
        validate({ root, mode: "initialized", expectedContract: contract }),
        {
          code: "invalid_origin",
          status: "invalid",
        },
      );
    }
    for (const malformedEscape of ["%", "%zz", "%0", "%0g"]) {
      writeFileSync(beanPath, bean.replace("source", malformedEscape));
      assert.deepEqual(
        validate({ root, mode: "initialized", expectedContract: contract }),
        {
          code: "invalid_origin",
          status: "invalid",
        },
      );
    }
    writeFileSync(
      beanPath,
      bean.replace(
        "  - https://example.com/source\n",
        "  - https://example.com/source\n  - https://example.com/source\n",
      ),
    );
    assert.deepEqual(
      validate({ root, mode: "initialized", expectedContract: contract }),
      {
        code: "duplicate_origin",
        status: "invalid",
      },
    );
    writeFileSync(
      beanPath,
      bean.replace(
        "  - https://example.com/source\n",
        "  - https://example.com/source\n  - https://example.com/source \n",
      ),
    );
    assert.deepEqual(
      validate({ root, mode: "initialized", expectedContract: contract }),
      {
        code: "invalid_origin",
        status: "invalid",
      },
    );

    writeFileSync(beanPath, bean);
    const unsafeBean = join(root, "roastery", "beans", "escape.md");
    symlinkSync("../index.json", unsafeBean);
    assert.deepEqual(
      validate({ root, mode: "initialized", expectedContract: contract }),
      {
        code: "unsafe_path",
        status: "invalid",
      },
    );
    unlinkSync(unsafeBean);

    unlinkSync(indexPath);
    symlinkSync(externalTarget, indexPath);
    assert.equal(projectIndex({ root }).bytes, expectedIndex);
    assert.deepEqual(checkIndex({ root }), {
      code: "unsafe_path",
      status: "invalid",
    });
    assert.equal(readFileSync(externalTarget, "utf8"), "unchanged\n");
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(external, { force: true, recursive: true });
  }
});
