import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

import { validate } from "../dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));

/** @type {import("../dist/index.js").ContractPin} */
const contract = {
  repository: "https://github.com/openboa-ai/coffee-chat-roastery",
  commit: "d7d770af59a691b5ebceee9809ab436f32db33d5",
  digest:
    "sha256:878704aa835d167ea6ef6979f7cd0258cf02476b3f7c16926779f4f18ce75428",
};

test("the official fork seed is exact, Bean-free, and valid", () => {
  const roasteryRoot = join(root, "roastery");
  assert.deepEqual(readdirSync(roasteryRoot).sort(), [
    "index.json",
    "roastery.json",
  ]);
  assert.equal(existsSync(join(roasteryRoot, "beans")), false);
  assert.equal(existsSync(join(roasteryRoot, "CONTENT_LICENSE.md")), false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(roasteryRoot, "roastery.json"), "utf8")),
    {
      repository: "https://github.com/openboa-ai/coffee-chat-roastery",
      contract,
    },
  );
  assert.equal(
    readFileSync(join(roasteryRoot, "index.json"), "utf8"),
    '{\n  "beans": []\n}\n',
  );
  assert.deepEqual(
    validate({ root, mode: "seed", expectedContract: contract }),
    {
      beanCount: 0,
      repository: "https://github.com/openboa-ai/coffee-chat-roastery",
      status: "valid",
    },
  );
});
