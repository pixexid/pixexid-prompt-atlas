#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sources = JSON.parse(
  await readFile(join(root, "data/sources.json"), "utf8"),
);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const projectCache = new Map();

const fail = (message) => {
  throw new Error(message);
};
const markdownEscape = (value) => String(value).replaceAll("|", "\\|");
const roleLabel = (value) => `${value[0].toUpperCase()}${value.slice(1)}`;
const htmlEscape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

async function fetchProject(url) {
  if (!projectCache.has(url))
    projectCache.set(
      url,
      fetch(url).then(async (response) => {
        if (!response.ok) fail(`Public composition unavailable: ${url}`);
        const html = await response.text();
        const match = html.match(
          /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
        );
        if (!match) fail(`Public composition data missing: ${url}`);
        return JSON.parse(match[1]).props?.pageProps?.project;
      }),
    );
  return projectCache.get(url);
}

async function fetchCase(source) {
  const canonical = new URL(source.canonical_url);
  const composition = new URL(source.composition_url);
  if (canonical.protocol !== "https:" || canonical.hostname !== "pixexid.com")
    fail(`Refusing non-Pixexid source: ${canonical}`);
  if (
    !canonical.pathname.startsWith("/i/") ||
    composition.hostname !== "pixexid.com" ||
    !composition.pathname.startsWith("/ai-composition/")
  )
    fail(`Invalid canonical or composition URL: ${canonical}`);

  const slug = basename(canonical.pathname);
  const [apiResponse, pageResponse, project] = await Promise.all([
    fetch(
      `https://pixexid.com/api/picture/by-filename/${encodeURIComponent(slug)}`,
    ),
    fetch(canonical),
    fetchProject(source.composition_url),
  ]);
  if (!apiResponse.ok || !pageResponse.ok || !project)
    fail(`Public source unavailable for ${slug}`);

  const [record, html] = await Promise.all([
    apiResponse.json(),
    pageResponse.text(),
  ]);
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/);
  const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (canonicalMatch?.[1] !== source.canonical_url || !imageMatch)
    fail(`Public page metadata mismatch for ${slug}`);
  if (
    !uuid.test(record.id) ||
    record.approved !== true ||
    !record.prompt ||
    !record.aiModel
  )
    fail(`Incomplete or unapproved public record for ${slug}`);
  if (record.gen_meta?.provenance?.moderation !== "approved")
    fail(`Public provenance is not approved for ${slug}`);

  const scene = project.scenes?.find(
    (item) => item.output?.publicImageId === record.id,
  );
  const step = scene?.steps?.at(-1);
  if (
    !step ||
    step.output?.prompt !== record.prompt ||
    step.inputs?.length !== record.gen_meta.creative.inputCount ||
    step.inputs.some((input) => !input.asset)
  )
    fail(`Incomplete public recipe for ${slug}`);

  const publicAsset = async (asset, role, index, output = false) => {
    const imageUrl = new URL(asset.mediaUrl, composition).href;
    const response = await fetch(imageUrl);
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("image/")
    )
      fail(
        `Public ${output ? "output" : "reference"} ${index + 1} unavailable for ${slug}`,
      );
    return {
      order: index + 1,
      role,
      id: asset.id,
      public_image_id: asset.publicImageId,
      title: asset.title,
      description: asset.description,
      prompt: asset.prompt,
      model: asset.model,
      kind: asset.kind,
      dimensions: { width: asset.width, height: asset.height },
      image_url: imageUrl,
    };
  };
  const rawSteps = await Promise.all(
    scene.steps.map(async (item, index) => ({
      order: index + 1,
      scene_id: item.sceneId,
      title: item.output.title,
      prompt: item.output.prompt,
      output: await publicAsset(item.output, "output", index, true),
      references: await Promise.all(
        item.inputs.map(({ role, asset }, inputIndex) =>
          publicAsset(asset, role, inputIndex),
        ),
      ),
    })),
  );
  const stageIds = [...new Set(rawSteps.map((item) => item.scene_id))];
  const stageTotals = new Map(
    stageIds.map((id) => [
      id,
      rawSteps.filter((item) => item.scene_id === id).length,
    ]),
  );
  const stageRevisions = new Map();
  const steps = rawSteps.map((item) => {
    const stage = stageIds.indexOf(item.scene_id) + 1;
    const revision = (stageRevisions.get(item.scene_id) || 0) + 1;
    stageRevisions.set(item.scene_id, revision);
    return {
      ...item,
      stage,
      revision,
      label: `Step ${stage}${stageTotals.get(item.scene_id) > 1 ? ` · Revision ${revision}` : ""}`,
    };
  });
  const references = steps.at(-1).references;

  return {
    id: record.id,
    slug: record.filename.replace(/\.(jpe?g|png|webp|avif)$/i, ""),
    title: record.title,
    description: record.description,
    prompt: record.prompt,
    model: record.aiModel,
    model_metadata: record.gen_meta.image_model,
    tags: record.tags,
    colors: record.colors,
    dimensions: { width: record.width, height: record.height },
    created_at: record.createdAt,
    canonical_url: canonicalMatch[1],
    image_url: imageMatch[1],
    composition_url: source.composition_url,
    references,
    steps,
    stage_count: stageIds.length,
    recipe: record.gen_meta.creative,
    provenance: record.gen_meta.provenance,
    output: record.gen_meta.output,
    post_processing: record.gen_meta.post,
    rights: {
      attribution: "Pixexid",
      basis: source.rights_basis,
      linked_image_license:
        "Excluded from this repository's CC BY 4.0 catalog license; see Pixexid Terms.",
    },
    source_api: `https://pixexid.com/api/picture/by-filename/${encodeURIComponent(slug)}`,
  };
}

function recipeVisual(item) {
  return item.steps
    .map((step) => {
      const inputs = step.references
        .map(
          (reference) => `<td align="center" valign="top">
<strong>${reference.order}. ${htmlEscape(roleLabel(reference.role))}</strong><br>
<a href="${reference.image_url}"><img src="${reference.image_url}" alt="${htmlEscape(reference.title)}" width="150"></a><br>
<sub>${htmlEscape(reference.title)}</sub>
</td>`,
        )
        .join("\n");
      const final = step.order === item.steps.length;
      return `### ${step.label} — ${htmlEscape(step.title)}

<table>
<tr>
${inputs}
</tr>
</table>

<p align="center"><strong>Ordered references → ${final ? "Final AI Image Composition" : "Step output"}</strong></p>

<p align="center">
<a href="${final ? item.canonical_url : step.output.image_url}"><img src="${final ? item.image_url : step.output.image_url}" alt="${htmlEscape(step.title)}" width="760"></a><br>
<strong>${htmlEscape(step.title)}</strong>
</p>

<details>
<summary>Exact prompt for ${step.label}</summary>

\`\`\`text
${step.prompt}
\`\`\`
</details>`;
    })
    .join("\n\n");
}

function caseMarkdown(item) {
  return `# ${item.title} — Multi-Reference AI Composition

**AI Image Composition recipe:** ${item.stage_count} steps → one final artwork.

${item.description}

## Ordered references → final result

${recipeVisual(item)}

Role labels and order come directly from the public Pixexid recipe.

| Field | Value |
| --- | --- |
| Model | ${markdownEscape(item.model)} |
| Format | ${item.dimensions.width} × ${item.dimensions.height} ${markdownEscape(item.output.format)} |
| Recipe | ${item.stage_count} steps · ${item.references.length} final-step inputs · ${markdownEscape(item.recipe.kind)} |
| Tags | ${item.tags.map((tag) => `\`${tag}\``).join(" ")} |
| Canonical | [Pixexid image page](${item.canonical_url}) |
| Composition | [Public AI Composition recipe](${item.composition_url}) |

## Exact public prompt

\`\`\`text
${item.prompt}
\`\`\`

## Provenance

| Field | Value |
| --- | --- |
| Generated | ${markdownEscape(item.provenance.generated_on)} |
| Moderation | ${markdownEscape(item.provenance.moderation)} |
| Output SHA-256 | \`${item.provenance.sha256}\` |
| Source SHA-256 | \`${item.provenance.source_sha256}\` |
| Import manifest SHA-256 | \`${item.provenance.import_manifest_sha256}\` |

Catalog text and data are licensed under [CC BY 4.0](../LICENSE). Linked images are not relicensed here. ${item.rights.basis}
`;
}

function readmeMarkdown(cases) {
  const gallery = cases
    .map(
      (item) => `## [${item.title}](cases/${item.slug}.md)

${item.description}

${recipeVisual(item)}

[Exact prompt and provenance](cases/${item.slug}.md) · [Canonical image](${item.canonical_url}) · [Public recipe](${item.composition_url})`,
    )
    .join("\n\n");
  return `<h1 align="center">Multi-Reference AI Composition — Pixexid Prompt Atlas</h1>

<p align="center"><strong>AI Image Compositions built from ordered visual references, exact prompts, and public recipes.</strong></p>

<p align="center">
  See how <a href="https://pixexid.com">Pixexid</a> turns identity, character, product, logo, style, and other visual references into reproducible final artwork.
</p>

<p align="center">
  <a href="data/cases.json"><img alt="JSON data" src="https://img.shields.io/badge/data-JSON-24443B"></a>
  <a href="LICENSE"><img alt="CC BY 4.0" src="https://img.shields.io/badge/catalog-CC_BY_4.0-D9775F"></a>
  <a href="LICENSE-CODE"><img alt="MIT licensed code" src="https://img.shields.io/badge/code-MIT-D7A236"></a>
</p>

This is a curated, machine-readable atlas of **Multi-Reference AI Composition** recipes. Every case below shows its ordered public inputs and each intermediate output, followed by the final result—so the complete method is visible without leaving GitHub.

${gallery}

## Use the structured data

Each case includes its ordered references, exact public prompt, model, dimensions, tags, palette, recipe metadata, and SHA-256 provenance in [\`data/cases.json\`](data/cases.json). The schema is [\`schema/cases.schema.json\`](schema/cases.schema.json).

\`\`\`sh
node -e 'const a=require("./data/cases.json"); console.log(a.cases.map(({title,references,prompt})=>({title,references:references.map(r=>r.role),prompt})))'
\`\`\`

## Refresh from Pixexid

The export is allowlisted: adding a case requires an explicit public Pixexid URL and a reviewed rights basis in [\`data/sources.json\`](data/sources.json).

\`\`\`sh
node scripts/export.mjs
node scripts/validate.mjs --links
\`\`\`

The dependency-free exporter reads only anonymous public Pixexid pages and APIs. It fails closed on unavailable pages, non-Pixexid hosts, unapproved moderation, missing reference previews, private recipes, mismatched input order, or incomplete provenance. It never connects to Pixexid's database or production credentials.

## Rights and safety

This atlas contains only Pixexid-admin-owned, original AI Image Compositions with public source sharing enabled. It excludes private user records, private masters, third-party source files, real-person identity material, secrets, and work with unclear rights.

Catalog text and structured data are [CC BY 4.0](LICENSE); scripts are [MIT](LICENSE-CODE). Linked images remain hosted by Pixexid and are not relicensed by this repository. See the [rights scope](RIGHTS.md) and [contribution policy](CONTRIBUTING.md).

Create and explore more [AI Image Compositions on Pixexid](https://pixexid.com).
`;
}

const cases = [];
for (const source of sources) cases.push(await fetchCase(source));
cases.sort((a, b) => b.created_at.localeCompare(a.created_at));

await mkdir(join(root, "cases"), { recursive: true });
await writeFile(
  join(root, "data/cases.json"),
  `${JSON.stringify({ schema_version: 1, cases }, null, 2)}\n`,
);
for (const item of cases)
  await writeFile(join(root, "cases", `${item.slug}.md`), caseMarkdown(item));
await writeFile(join(root, "README.md"), readmeMarkdown(cases));

console.log(`Exported ${cases.length} public Pixexid AI Image Compositions.`);
