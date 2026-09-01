#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sources = JSON.parse(await readFile(join(root, "data/sources.json"), "utf8"));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fail = (message) => {
  throw new Error(message);
};

const markdownEscape = (value) => String(value).replaceAll("|", "\\|");

async function fetchCase(source) {
  const canonical = new URL(source.canonical_url);
  const composition = new URL(source.composition_url);
  if (canonical.protocol !== "https:" || canonical.hostname !== "pixexid.com")
    fail(`Refusing non-Pixexid source: ${canonical}`);
  if (!canonical.pathname.startsWith("/i/") || composition.hostname !== "pixexid.com")
    fail(`Invalid canonical or composition URL: ${canonical}`);

  const slug = basename(canonical.pathname);
  const [apiResponse, pageResponse, compositionResponse] = await Promise.all([
    fetch(`https://pixexid.com/api/picture/by-filename/${encodeURIComponent(slug)}`),
    fetch(canonical),
    fetch(composition),
  ]);
  if (!apiResponse.ok || !pageResponse.ok || !compositionResponse.ok)
    fail(`Public source unavailable for ${slug}`);

  const [record, html] = await Promise.all([apiResponse.json(), pageResponse.text()]);
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/);
  const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (canonicalMatch?.[1] !== source.canonical_url || !imageMatch)
    fail(`Public page metadata mismatch for ${slug}`);
  if (!uuid.test(record.id) || record.approved !== true || !record.prompt || !record.aiModel)
    fail(`Incomplete or unapproved public record for ${slug}`);
  if (record.gen_meta?.provenance?.moderation !== "approved")
    fail(`Public provenance is not approved for ${slug}`);

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
    recipe: record.gen_meta.creative,
    provenance: record.gen_meta.provenance,
    output: record.gen_meta.output,
    post_processing: record.gen_meta.post,
    rights: {
      attribution: "Pixexid",
      basis: source.rights_basis,
      linked_image_license: "Excluded from this repository's CC BY 4.0 catalog license; see Pixexid Terms.",
    },
    source_api: `https://pixexid.com/api/picture/by-filename/${encodeURIComponent(slug)}`,
  };
}

function caseMarkdown(item) {
  return `# ${item.title}

[![${item.title}](${item.image_url})](${item.canonical_url})

${item.description}

| Field | Value |
| --- | --- |
| Model | ${markdownEscape(item.model)} |
| Format | ${item.dimensions.width} × ${item.dimensions.height} ${markdownEscape(item.output.format)} |
| Recipe | ${item.recipe.inputCount} public inputs · ${markdownEscape(item.recipe.kind)} |
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

Catalog text and data are licensed under [CC BY 4.0](../LICENSE). The linked image is not relicensed here. ${item.rights.basis}
`;
}

const cases = [];
for (const source of sources) cases.push(await fetchCase(source));

await mkdir(join(root, "cases"), { recursive: true });
await writeFile(
  join(root, "data/cases.json"),
  `${JSON.stringify({ schema_version: 1, cases }, null, 2)}\n`,
);
for (const item of cases)
  await writeFile(join(root, "cases", `${item.slug}.md`), caseMarkdown(item));

console.log(`Exported ${cases.length} public Pixexid cases.`);
