# vote

A deep-dive tracker for California statewide propositions and Santa Clara County ballot measures.

Each measure gets its own page answering the questions a ballot pamphlet does not: what the text
really does, what it costs and who pays, who gains authority over whom, which gaps in the wording
are exploitable, and what unrelated provisions got bundled in. The landing page groups measures
into California Statewide and Santa Clara County, sorted by election date.

## This pipeline does not write the analysis

Nothing here generates content. The scripts validate structure and render HTML. Every sentence of
summary, deep dive, fiscal narrative, loophole, pro, and con is written by a person doing real
research against primary sources. A measure file with the template's placeholder text in it is not
a finished measure, and the validator cannot tell the difference. That check is yours.

## Requirements

Node.js 20 or newer. There are no npm dependencies and never will be. The scripts use only Node
built-ins, and the generated site loads no fonts, scripts, or assets from any CDN, so it works
fully offline.

## Quick start

```sh
npm run build -- --include-template   # render the example measure
open dist/index.html
```

A plain `npm run build` skips `_TEMPLATE.json` and produces an empty site, which is the correct
output for a repository with no real measures in it yet.

## Layout

```
schema/measure.schema.json   The data shape. One property per field, each with a description.
                             This is the single source of truth: scripts/validate.mjs validates
                             against it, so adding a field means editing this file only.
scripts/validate.mjs         Exports validateMeasure(obj) -> array of problems. CLI mode checks
                             every content/measures/*.json.
scripts/build.mjs            Renders dist/index.html and dist/measures/<id>.html, copies the
                             stylesheet. Aborts if any measure file fails validation.
scripts/fetch-sources.mjs    Archives the primary sources a measure cites.
content/measures/            One JSON file per measure, named <id>.json. Files starting with "_"
                             are scaffolding and stay out of the site.
content/sources/             Archived raw source bodies plus a manifest, written by the fetcher.
                             Git-ignored: large and regenerable.
public/style.css             The only stylesheet. Hand-written, mobile-first, dark mode aware.
dist/                        Build output. Git-ignored.
```

## Adding a measure

1. Copy the template to its real id. The filename must match the `id` field inside it.

   ```sh
   cp content/measures/_TEMPLATE.json content/measures/ca-prop-1-2026.json
   ```

   Use `ca-prop-<n>-<year>` for statewide propositions and `scc-measure-<letter>-<year>` for
   Santa Clara County measures.

2. Fill every field with researched content. Replace all of it. The template's prose exists to
   show what belongs in each field, not to be kept. Set `jurisdiction` to `state` and delete the
   `county` field for a statewide proposition; set it to `county` and keep `county` for a local
   measure. `schema/measure.schema.json` describes what each field is for.

3. Archive the sources you cited, so the analysis stays checkable after the originals move or
   disappear.

   ```sh
   npm run fetch ca-prop-1-2026
   ```

   This fetches every url in the measure's `sources[]`, saves the raw body under
   `content/sources/ca-prop-1-2026/`, and writes a `manifest.json` recording the url, title,
   retrieval timestamp, saved filename, and HTTP status for each. A failed fetch is logged and
   recorded in the manifest without stopping the others.

4. Catch missing or malformed fields.

   ```sh
   npm run validate
   ```

   Problems are reported by field path, such as `fiscal_impact.narrative: missing required
   property` or `sources[1].url: missing required property`. Exit code is 1 if any file is invalid.

5. Build and read the result.

   ```sh
   npm run build
   open dist/index.html
   ```

## Commands

| Command | What it does |
| --- | --- |
| `npm run validate` | Validates every measure file against the schema. Exit 1 on any problem. |
| `npm run validate -- --include-template` | Also validates `_TEMPLATE.json`. |
| `npm run build` | Renders the site into `dist/`. Refuses to build if any measure is invalid. |
| `npm run build -- --include-template` | Also renders the example measure, for previewing layout. |
| `npm run fetch <measure-id>` | Archives that measure's cited sources into `content/sources/`. |

## Notes on the rendering

All field content is HTML-escaped, so nothing in a JSON string can inject markup into a page.
Links are rendered as anchors only when the url is `http` or `https`; anything else is printed as
inert text. Every detail page renders the same sections in the same fixed order, set by the
`SECTIONS` table in `scripts/build.mjs`, so two measures are directly comparable section by
section.
