import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { digestContractBundle } from "../contract/digest.js";
import { contractBundlePaths, loadContractManifest, SCHEMA_FILE_KEYS, } from "../contract/manifest.js";
import { CONTENT_LICENSE_IDENTIFIER, CONTENT_LICENSE_SCOPE, } from "../contract/types.js";
import { renderContentLicense } from "../projection/content-license.js";
import { parseContentLicense } from "./content-license.js";
import { requireNoFollowPath } from "./filesystem.js";
const PLACEHOLDER = "<OWNER_PROVIDED_ATTRIBUTION>";
const TEMPLATE_ATTRIBUTION = "Contract Validator";
async function collectContractPaths(contractRoot, directory = contractRoot) {
    const paths = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolutePath = join(directory, entry.name);
        const metadata = await lstat(absolutePath);
        if (metadata.isSymbolicLink())
            throw new Error("bundle_validation_failed");
        if (metadata.isDirectory()) {
            paths.push(...(await collectContractPaths(contractRoot, absolutePath)));
        }
        else if (metadata.isFile()) {
            paths.push(`contract/${relative(contractRoot, absolutePath).split(sep).join("/")}`);
        }
        else {
            throw new Error("bundle_validation_failed");
        }
    }
    return paths.sort();
}
function schemaValidators(validators) {
    const roastery = validators.get("roastery_schema");
    const index = validators.get("index_schema");
    const beanFrontmatter = validators.get("bean_frontmatter_schema");
    const contentLicense = validators.get("content_license_schema");
    if (roastery === undefined ||
        index === undefined ||
        beanFrontmatter === undefined ||
        contentLicense === undefined) {
        throw new Error("bundle_validation_failed");
    }
    return { roastery, index, beanFrontmatter, contentLicense };
}
export async function validateContractBundle(root, declarationBytes) {
    await requireNoFollowPath(root, "contract", "directory");
    const manifest = await loadContractManifest(root);
    const inventory = contractBundlePaths(manifest);
    const actualContractPaths = await collectContractPaths(resolve(root, "contract"));
    const declaredContractPaths = inventory
        .filter((path) => path.startsWith("contract/"))
        .sort();
    if (JSON.stringify(actualContractPaths) !==
        JSON.stringify(declaredContractPaths)) {
        throw new Error("bundle_validation_failed");
    }
    const ajv = new Ajv2020.default({ allErrors: true, strict: true });
    const compiled = new Map();
    for (const key of SCHEMA_FILE_KEYS) {
        const schema = JSON.parse(await readFile(resolve(root, manifest.files[key]), "utf8"));
        compiled.set(key, ajv.compile(schema));
    }
    const schemas = schemaValidators(compiled);
    const template = await readFile(resolve(root, manifest.files.content_license_template), "utf8");
    if (template.replaceAll(PLACEHOLDER, TEMPLATE_ATTRIBUTION) !==
        renderContentLicense({
            scope: CONTENT_LICENSE_SCOPE,
            license: CONTENT_LICENSE_IDENTIFIER,
            attribution: TEMPLATE_ATTRIBUTION,
        })) {
        throw new Error("bundle_validation_failed");
    }
    for (const key of [
        "init_contract",
        "publication_contract",
        "security_contract",
    ]) {
        if ((await readFile(resolve(root, manifest.files[key]), "utf8")).trim() === "") {
            throw new Error("bundle_validation_failed");
        }
    }
    if (declarationBytes !== undefined) {
        const declaration = parseContentLicense(declarationBytes, schemas.contentLicense);
        if (declaration.status !== "supported") {
            throw new Error("bundle_validation_failed");
        }
    }
    return {
        digest: await digestContractBundle(root),
        inventory,
        manifest,
        policy: manifest.content_license,
        schemas,
        validation: "passed",
    };
}
