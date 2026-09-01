<p align="center">
  <a href="https://pixexid.com/i/mara-brings-tavi-to-life-8afa70b8-8ab0-5349-a8b3-8cfa8ff37f6c">
    <img src="https://images.pixexid.com/mara-brings-tavi-to-life-8afa70b8-8ab0-5349-a8b3-8cfa8ff37f6c.jpg" alt="Mara brings Tavi to life in a folded-paper pavilion" width="900">
  </a>
</p>

<h1 align="center">Pixexid Prompt Atlas</h1>

<p align="center"><strong>Exact prompts, real outputs, public recipes.</strong></p>

<p align="center">
  A curated, machine-readable window into how <a href="https://pixexid.com">Pixexid</a> builds reproducible AI compositions.
</p>

<p align="center">
  <a href="data/cases.json"><img alt="JSON data" src="https://img.shields.io/badge/data-JSON-24443B"></a>
  <a href="LICENSE"><img alt="CC BY 4.0" src="https://img.shields.io/badge/catalog-CC_BY_4.0-D9775F"></a>
  <a href="LICENSE-CODE"><img alt="MIT licensed code" src="https://img.shields.io/badge/code-MIT-D7A236"></a>
</p>

## Start here

Each case includes the exact public prompt, model, dimensions, tags, palette, recipe metadata, and SHA-256 provenance already exposed by Pixexid. Use the readable case page, consume [`data/cases.json`](data/cases.json), or open the complete public recipe on Pixexid.

| Case | What it demonstrates | Recipe |
| --- | --- | --- |
| [Mara Brings Tavi to Life](cases/mara-brings-tavi-to-life-8afa70b8-8ab0-5349-a8b3-8cfa8ff37f6c.md) | Five-reference character, persona, product, logo, and style composition | [Open](https://pixexid.com/ai-composition/6efb2dae-6c8c-4cfc-b4c6-4f21efd6d3ae) |
| [Dev Laughing in the Greenhouse](cases/dev-laughing-in-the-greenhouse-03d91188-a399-5cff-a679-76036c37a3db.md) | Identity under expression and wardrobe change | [Open](https://pixexid.com/ai-composition/c5fa9811-5b24-4bf1-b4a4-ef28506cd382) |
| [Dev on the Rainwashed Boardwalk](cases/dev-on-the-rainwashed-boardwalk-2d33ce3c-a2b4-5f94-a4f7-690c7471c9b7.md) | Full-body motion and environmental consistency | [Open](https://pixexid.com/ai-composition/c5fa9811-5b24-4bf1-b4a4-ef28506cd382) |
| [Dev Builds a Folded Paper Form](cases/dev-builds-a-folded-paper-form-ac4ae603-d1fa-547c-ae4c-db37eb39eb77.md) | Hands, object interaction, and wide composition | [Open](https://pixexid.com/ai-composition/c5fa9811-5b24-4bf1-b4a4-ef28506cd382) |

## Use it

No install is required.

```sh
node -e 'const a=require("./data/cases.json"); console.log(a.cases.map(({title,prompt})=>({title,prompt})))'
```

Agents can read the same stable JSON and follow `canonical_url` for the authoritative public work or `composition_url` for its recipe. The schema is [`schema/cases.schema.json`](schema/cases.schema.json).

## Refresh from Pixexid

The export is allowlisted: adding a case requires an explicit public Pixexid URL and a reviewed rights basis in [`data/sources.json`](data/sources.json).

```sh
node scripts/export.mjs
node scripts/validate.mjs --links
```

The exporter reads only anonymous public Pixexid pages and APIs. It fails closed on unavailable pages, non-Pixexid hosts, unapproved moderation, private recipes, or incomplete provenance. It never connects to Pixexid's database or production credentials.

## Rights and safety

This v1 contains only Pixexid-admin-owned, original AI-generated compositions with public source sharing enabled. It deliberately excludes private user records, source reference files, real-person identity material, secrets, and work with unclear rights.

Catalog text and structured data are [CC BY 4.0](LICENSE); scripts are [MIT](LICENSE-CODE). Linked images remain hosted by Pixexid and are not relicensed by this repository. See the [rights scope](RIGHTS.md) and [contribution policy](CONTRIBUTING.md) before proposing a case.

Explore more at [pixexid.com](https://pixexid.com).
