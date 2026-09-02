#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(
  await readFile(join(root, "data/cases.json"), "utf8"),
);
const schema = JSON.parse(
  await readFile(join(root, "schema/cases.schema.json"), "utf8"),
);
const readme = await readFile(join(root, "README.md"), "utf8");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
const forbiddenKeys =
  /^(user|owner|email|avatar|secret|token|cookie|authorization)$/i;

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

assert(
  schema.$id ===
    "https://github.com/pixexid/pixexid-prompt-atlas/schema/cases.schema.json",
  "Unexpected schema id",
);
assert(catalog.schema_version === 1, "Unsupported schema version");
assert(
  Array.isArray(catalog.cases) && catalog.cases.length > 0,
  "Catalog is empty",
);
assert(
  new Set(catalog.cases.map((item) => item.id)).size === catalog.cases.length,
  "Duplicate ids",
);
assert(
  readme.includes("AI Image Compositions") &&
    readme.includes("Multi-Reference AI Composition"),
  "README positioning missing",
);
checkKeys(catalog);

for (const item of catalog.cases) {
  assert(uuid.test(item.id), `Invalid id: ${item.id}`);
  assert(
    item.title && item.description && item.prompt,
    `Missing text: ${item.id}`,
  );
  assert(item.model === item.model_metadata.name, `Model mismatch: ${item.id}`);
  assert(
    item.recipe.shareInputs === true && item.recipe.inputCount > 0,
    `Recipe is not public: ${item.id}`,
  );
  assert(
    item.references.length === item.recipe.inputCount,
    `Reference count mismatch: ${item.id}`,
  );
  assert(
    Array.isArray(item.steps) && item.steps.length > 0,
    `Recipe steps missing: ${item.id}`,
  );
  assert(
    item.stage_count === new Set(item.steps.map((step) => step.scene_id)).size,
    `Stage count mismatch: ${item.id}`,
  );
  assert(
    item.steps.at(-1).output.public_image_id === item.id,
    `Final step output mismatch: ${item.id}`,
  );
  item.references.forEach((reference, index) => {
    assert(
      reference.order === index + 1,
      `Reference order mismatch: ${item.id}`,
    );
    assert(uuid.test(reference.id), `Invalid reference id: ${item.id}`);
    assert(
      reference.role && reference.title,
      `Incomplete reference: ${item.id}`,
    );
    assert(
      new URL(reference.image_url).hostname === "pixexid.com",
      `Invalid reference URL: ${item.id}`,
    );
  });
  assert(
    item.provenance.moderation === "approved",
    `Unapproved case: ${item.id}`,
  );
  for (const key of ["sha256", "source_sha256", "import_manifest_sha256"])
    assert(sha256.test(item.provenance[key]), `Invalid ${key}: ${item.id}`);
  for (const key of ["canonical_url", "composition_url", "source_api"])
    assert(
      new URL(item[key]).hostname === "pixexid.com",
      `Invalid ${key}: ${item.id}`,
    );
  assert(
    new URL(item.image_url).hostname === "images.pixexid.com",
    `Invalid image URL: ${item.id}`,
  );
  const casePath = join(root, "cases", `${item.slug}.md`);
  await access(casePath);
  const casePage = await readFile(casePath, "utf8");
  for (const step of item.steps) {
    assert(
      step.order >= 1 && step.title && step.prompt,
      `Incomplete step: ${item.id}`,
    );
    assert(uuid.test(step.output.id), `Invalid step output: ${item.id}`);
    for (const reference of step.references)
      assert(uuid.test(reference.id), `Invalid step reference: ${item.id}`);
  }
  for (const [name, page] of [
    ["README", readme],
    ["Case", casePage],
  ]) {
    let cursor = page.indexOf(
      `## ${String(catalog.cases.indexOf(item) + 1).padStart(2, "0")} —`,
    );
    if (name === "Case") cursor = 0;
    for (const step of item.steps) {
      const stepIndex = page.indexOf(`${step.label} — ${step.title}`, cursor);
      const outputUrl =
        step.order === item.steps.length
          ? item.image_url
          : step.output.image_url;
      const outputIndex = page.indexOf(`src="${outputUrl}"`, stepIndex);
      assert(
        stepIndex >= cursor && outputIndex > stepIndex,
        `${name} step order is invalid: ${item.id}`,
      );
      cursor = outputIndex;
    }
  }
}

if (process.argv.includes("--links")) {
  const links = new Set(
    catalog.cases.flatMap((item) => [
      item.canonical_url,
      item.composition_url,
      item.image_url,
      item.source_api,
      ...item.steps.flatMap((step) => [
        step.output.image_url,
        ...step.references.map((reference) => reference.image_url),
      ]),
    ]),
  );
  const results = await Promise.all(
    [...links].map(async (url) => [
      url,
      await fetch(url, { signal: AbortSignal.timeout(15_000) }),
    ]),
  );
  for (const [url, response] of results) {
    assert(response.ok, `Broken link ${response.status}: ${url}`);
    if (url.includes("/api/creative-assets/"))
      assert(
        response.headers.get("content-type")?.startsWith("image/"),
        `Non-image reference: ${url}`,
      );
  }
}

console.log(
  `Validated ${catalog.cases.length} cases${process.argv.includes("--links") ? " and public links" : ""}.`,
);
