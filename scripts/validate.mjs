#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(await readFile(join(root, "data/cases.json"), "utf8"));
const schema = JSON.parse(await readFile(join(root, "schema/cases.schema.json"), "utf8"));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
const forbiddenKeys = /^(user|owner|email|avatar|secret|token|cookie|authorization)$/i;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function checkKeys(value, path = "catalog") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!forbiddenKeys.test(key), `Private field ${path}.${key}`);
    checkKeys(child, `${path}.${key}`);
  }
}

assert(schema.$id === "https://github.com/pixexid/pixexid-prompt-atlas/schema/cases.schema.json", "Unexpected schema id");
assert(catalog.schema_version === 1, "Unsupported schema version");
assert(Array.isArray(catalog.cases) && catalog.cases.length > 0, "Catalog is empty");
assert(new Set(catalog.cases.map((item) => item.id)).size === catalog.cases.length, "Duplicate ids");
checkKeys(catalog);

for (const item of catalog.cases) {
  assert(uuid.test(item.id), `Invalid id: ${item.id}`);
  assert(item.title && item.description && item.prompt, `Missing text: ${item.id}`);
  assert(item.model === item.model_metadata.name, `Model mismatch: ${item.id}`);
  assert(item.recipe.shareInputs === true && item.recipe.inputCount > 0, `Recipe is not public: ${item.id}`);
  assert(item.provenance.moderation === "approved", `Unapproved case: ${item.id}`);
  for (const key of ["sha256", "source_sha256", "import_manifest_sha256"])
    assert(sha256.test(item.provenance[key]), `Invalid ${key}: ${item.id}`);
  for (const key of ["canonical_url", "composition_url", "source_api"])
    assert(new URL(item[key]).hostname === "pixexid.com", `Invalid ${key}: ${item.id}`);
  assert(new URL(item.image_url).hostname === "images.pixexid.com", `Invalid image URL: ${item.id}`);
  await access(join(root, "cases", `${item.slug}.md`));
}

if (process.argv.includes("--links")) {
  const links = new Set(catalog.cases.flatMap((item) => [item.canonical_url, item.composition_url, item.image_url, item.source_api]));
  const results = await Promise.all([...links].map(async (url) => [url, await fetch(url)]));
  for (const [url, response] of results) assert(response.ok, `Broken link ${response.status}: ${url}`);
}

console.log(`Validated ${catalog.cases.length} cases${process.argv.includes("--links") ? " and public links" : ""}.`);
