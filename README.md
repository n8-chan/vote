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
schema/measure.schema.json   The measure data shape. One property per field, each with a
                             description. Single source of truth: scripts/validate.mjs validates
                             against it, so adding a field means editing this file only.
schema/person.schema.json    The person (candidate/author/proponent) data shape, same convention.
schema/race.schema.json      The race-for-office data shape, same convention.
scripts/validate.mjs         Exports validateMeasure(obj) and validatePerson(obj), each ->
                             array of problems. CLI mode checks every content/measures/*.json
                             and content/people/*.json.
scripts/build.mjs            Renders dist/index.html, dist/measures/<id>.html, dist/people/
                             index.html, and dist/people/<id>.html, and copies the stylesheet.
                             Aborts if any measure or person file fails validation.
scripts/fetch-sources.mjs    Archives the primary sources a measure cites.
content/measures/            One JSON file per measure, named <id>.json. Files starting with "_"
                             are scaffolding and stay out of the site.
content/people/              One JSON file per person profile, named <id>.json, linked from a
                             measure's authors[].person_id or a race's candidates[].person_id.
                             Same "_" convention.
content/races/               One JSON file per contest for office, named <id>.json, rendered to
                             dist/races/<id>.html with the candidates side by side.
content/sources/             Archived raw source bodies plus a manifest, written by the fetcher.
                             Git-ignored: large and regenerable.
public/style.css             The only stylesheet. Hand-written, mobile-first, dark mode aware.
dist/                        Build output. Git-ignored.
```

## The `authors` and `funding` fields

A measure's `authors[]` credits whoever wrote or filed it (legislative authors/coauthors, or an
initiative's proponents). Each entry is `{name, role}`, plus an optional `person_id` that links the
name to a full profile in `content/people/` — their background, district, years of service,
committee memberships, voting-record highlights, attendance record, endorsements they've received,
and prior measures they've authored. Omit `person_id` if no profile exists yet; the name still
renders, just without a link.

A measure's `funding` field is about money, not endorsement: registered support/oppose committees,
what they've raised, and named donors where a reliable breakdown exists. This is distinct from
`who_supports`/`who_opposes`, which are public positions. Never fabricate a donor or amount — an
empty `top_donors` array is the honest answer when no breakdown was found.

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

## Adding a person profile

1. Copy the template to a kebab-case id matching the person's name, e.g. `buffy-wicks.json`.

   ```sh
   cp content/people/_TEMPLATE.json content/people/buffy-wicks.json
   ```

2. Fill every field with researched content: their official bio, district, committee memberships,
   specific citable past votes (not a general label), their attendance/participation record if
   published, endorsements they've received, and prior measures they've authored with outcomes.
   `schema/person.schema.json` describes each field.

3. Reference them from a measure by adding `"person_id": "buffy-wicks"` to the matching entry in
   that measure's `authors[]`. The build links the author's name to their profile automatically;
   no other wiring needed.

4. `npm run validate` and `npm run build` as above — both now also check `content/people/`.

## Adding a race

1. Create `content/races/<id>.json`, using `<jurisdiction>-<office>-<year>` for the id, e.g.
   `ca-governor-2026` or `us-house-ca-16-2026`. `schema/race.schema.json` describes each field.

2. For each candidate, add a profile in `content/people/` (type `candidate` if they hold no current
   office) and set `person_id` on their entry in the race's `candidates[]`. The candidate's profile
   page links back to the race automatically.

3. `npm run validate` and `npm run build`.

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
