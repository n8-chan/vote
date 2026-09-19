#!/usr/bin/env node
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listMeasureFiles, readMeasureFile, ROOT } from './validate.mjs';

const DIST = path.join(ROOT, 'dist');
const SITE_TITLE = 'California Propositions and Santa Clara County Ballot Measures';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** Only http(s) links are rendered as anchors, so a JSON string can never become a javascript: URL. */
function httpUrl(raw) {
  try {
    const url = new URL(String(raw));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function link(raw, text) {
  const href = httpUrl(raw);
  if (!href) return `${esc(text)} <code class="bad-url">${esc(raw)}</code>`;
  return `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${esc(text)}</a>`;
}

const paragraphs = (items) => items.map((item) => `<p>${esc(item)}</p>`).join('\n');

function bullets(items, className = '') {
  if (items.length === 0) return '<p class="empty">None listed.</p>';
  const attr = className ? ` class="${className}"` : '';
  return `<ul${attr}>\n${items.map((item) => `<li>${esc(item)}</li>`).join('\n')}\n</ul>`;
}

function facts(pairs) {
  const rows = pairs
    .map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`)
    .join('\n');
  return `<dl class="facts">\n${rows}\n</dl>`;
}

const STATUS_LABELS = {
  qualified: 'Qualified',
  pending: 'Pending',
  on_ballot: 'On ballot',
  passed: 'Passed',
  failed: 'Failed',
};

const FISCAL_LABELS = [
  ['state_cost', 'State cost'],
  ['state_savings', 'State savings'],
  ['local_cost', 'Local cost'],
  ['revenue_change', 'Revenue change'],
  ['ongoing_vs_one_time', 'Ongoing vs. one-time'],
];

const PARTY_LABELS = {
  org: 'Organization',
  politician: 'Politician',
  business: 'Business',
  other: 'Other',
};

function statusBadge(measure) {
  const label = STATUS_LABELS[measure.status] ?? measure.status;
  return `<span class="badge status status-${esc(measure.status)}">${esc(label)}</span>`;
}

function jurisdictionBadge(measure) {
  const label = measure.jurisdiction === 'county' ? `${measure.county} County` : 'California statewide';
  return `<span class="badge jurisdiction jurisdiction-${esc(measure.jurisdiction)}">${esc(label)}</span>`;
}

function parties(entries) {
  if (!entries || entries.length === 0) return '<p class="empty">None listed.</p>';
  const items = entries
    .map((entry) => {
      const kind = PARTY_LABELS[entry.type] ?? entry.type;
      const notes = entry.notes ? `<p class="notes">${esc(entry.notes)}</p>` : '';
      return `<li><strong>${esc(entry.name)}</strong> <span class="party-type">${esc(kind)}</span>${notes}</li>`;
    })
    .join('\n');
  return `<ul class="parties">\n${items}\n</ul>`;
}

/** Detail-page sections, rendered top to bottom in this order. */
const SECTIONS = [
  { heading: 'Summary', render: (m) => paragraphs([m.summary]) },
  { heading: 'What It Really Means', render: (m) => paragraphs(m.what_it_really_means) },
  {
    heading: 'Fiscal Impact',
    render: (m) =>
      facts(FISCAL_LABELS.map(([key, term]) => [term, m.fiscal_impact[key]])) +
      '\n' +
      paragraphs([m.fiscal_impact.narrative]),
  },
  {
    heading: 'Taxes',
    render: (m) =>
      `<h3>New taxes</h3>\n${bullets(m.taxes.new_taxes)}\n<h3>Changes to existing taxes</h3>\n${bullets(m.taxes.tax_changes)}`,
  },
  {
    heading: 'Spending',
    render: (m) =>
      `<h3>New spending areas</h3>\n${bullets(m.spending.new_spending_areas)}\n<h3>Funding source</h3>\n${paragraphs([m.spending.funding_source])}`,
  },
  { heading: 'Who Gains Control', render: (m) => paragraphs([m.control_and_power]) },
  { heading: 'Loopholes and Fine Print', render: (m) => bullets(m.loopholes) },
  { heading: 'Unexpected Provisions (Riders)', render: (m) => bullets(m.unexpected_provisions) },
  { heading: 'Pros', render: (m) => bullets(m.pros, 'pros') },
  { heading: 'Cons', render: (m) => bullets(m.cons, 'cons') },
  {
    heading: 'Who Supports and Who Opposes',
    render: (m) =>
      `<div class="columns">\n<div class="column supports"><h3>Supports</h3>${parties(m.who_supports)}</div>\n<div class="column opposes"><h3>Opposes</h3>${parties(m.who_opposes)}</div>\n</div>`,
  },
  {
    heading: 'Nonpartisan Analysis',
    render: (m) => {
      if (m.nonpartisan_analysis.length === 0) return '<p class="empty">No nonpartisan analysis published yet.</p>';
      const items = m.nonpartisan_analysis
        .map(
          (entry) =>
            `<li><strong>${esc(entry.source)}</strong><p>${esc(entry.summary)}</p><p class="source-link">${link(entry.url, 'Read the analysis')}</p></li>`,
        )
        .join('\n');
      return `<ul class="analysis">\n${items}\n</ul>`;
    },
  },
  {
    heading: 'Sources',
    render: (m) => {
      const items = m.sources
        .map(
          (source) =>
            `<li>${link(source.url, source.title)} <span class="retrieved">retrieved ${esc(source.retrieved)}</span></li>`,
        )
        .join('\n');
      return `<ul class="sources">\n${items}\n</ul>`;
    },
  },
];

function page({ title, description, stylesheet, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="${stylesheet}">
</head>
<body>
${body}
</body>
</html>
`;
}

function renderDetail(measure, { isTemplate }) {
  const banner = isTemplate
    ? '<p class="template-warning">This is the example template, not a real measure. Every fact below is made up.</p>'
    : '';
  const sections = SECTIONS.map(
    (section) => `<section>\n<h2>${esc(section.heading)}</h2>\n${section.render(measure)}\n</section>`,
  ).join('\n');

  const body = `<a class="back" href="../index.html">Back to all measures</a>
<article>
<header class="measure-header">
${banner}
<p class="eyebrow">${esc(measure.number)}</p>
<h1>${esc(measure.title)}</h1>
<p class="badges">${jurisdictionBadge(measure)}${statusBadge(measure)}</p>
${facts([
  ['Election', measure.election_date],
  ['Identifier', measure.id],
])}
</header>
${sections}
</article>
<footer>
<p>Last updated ${esc(measure.last_updated)}.</p>
<p><a class="back" href="../index.html">Back to all measures</a></p>
</footer>`;

  return page({
    title: `${measure.number}: ${measure.title}`,
    description: measure.summary,
    stylesheet: '../style.css',
    body,
  });
}

const GROUPS = [
  {
    heading: 'California Statewide',
    blurb: 'Propositions on the statewide California ballot.',
    includes: (measure) => measure.jurisdiction === 'state',
  },
  {
    heading: 'Santa Clara County',
    blurb: 'Local measures on the Santa Clara County ballot.',
    includes: (measure) => measure.jurisdiction === 'county',
  },
];

function card(measure) {
  return `<li class="card">
<p class="badges">${jurisdictionBadge(measure)}${statusBadge(measure)}</p>
<h3><a href="measures/${esc(measure.id)}.html">${esc(measure.number)}: ${esc(measure.title)}</a></h3>
<p class="card-summary">${esc(measure.summary)}</p>
<p class="card-meta">Election ${esc(measure.election_date)}</p>
</li>`;
}

function renderIndex(measures) {
  const sorted = [...measures].sort(
    (a, b) =>
      a.election_date.localeCompare(b.election_date) ||
      a.number.localeCompare(b.number, 'en', { numeric: true }),
  );

  const groups = GROUPS.map((group) => {
    const members = sorted.filter(group.includes);
    const contents =
      members.length === 0
        ? '<p class="empty">No measures tracked yet.</p>'
        : `<ul class="cards">\n${members.map(card).join('\n')}\n</ul>`;
    return `<section>\n<h2>${esc(group.heading)}</h2>\n<p class="blurb">${esc(group.blurb)}</p>\n${contents}\n</section>`;
  }).join('\n');

  const body = `<header class="site-header">
<h1>${esc(SITE_TITLE)}</h1>
<p class="blurb">Plain-language deep dives on what each measure does, what it costs, who gains power, and what is buried in the fine print.</p>
</header>
${groups}
<footer>
<p>Every word of analysis on this site is written by a person. The build scripts only check structure and render it.</p>
</footer>`;

  return page({
    title: SITE_TITLE,
    description:
      'Deep-dive analysis of California statewide propositions and Santa Clara County ballot measures.',
    stylesheet: 'style.css',
    body,
  });
}

function main(argv) {
  const includeTemplate = argv.includes('--include-template');
  const files = listMeasureFiles({ includeTemplate });

  const measures = [];
  const failures = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const { measure, errors } = readMeasureFile(file);
    if (errors.length > 0) {
      failures.push(`${rel}\n${errors.map((error) => `       ${error}`).join('\n')}`);
      continue;
    }
    measures.push({ measure, isTemplate: path.basename(file).startsWith('_') });
  }

  if (failures.length > 0) {
    console.error(`Build aborted: ${failures.length} measure file(s) failed validation.\n`);
    for (const failure of failures) console.error(`FAIL ${failure}\n`);
    console.error('Fix the files above, or run `npm run validate` to see the full list.');
    return 1;
  }

  const ids = new Set();
  for (const { measure } of measures) {
    if (ids.has(measure.id)) {
      console.error(`Build aborted: duplicate measure id "${measure.id}".`);
      return 1;
    }
    ids.add(measure.id);
  }

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(path.join(DIST, 'measures'), { recursive: true });
  copyFileSync(path.join(ROOT, 'public', 'style.css'), path.join(DIST, 'style.css'));

  writeFileSync(path.join(DIST, 'index.html'), renderIndex(measures.map((entry) => entry.measure)));
  for (const { measure, isTemplate } of measures) {
    writeFileSync(path.join(DIST, 'measures', `${measure.id}.html`), renderDetail(measure, { isTemplate }));
  }

  console.log(`Built dist/index.html and ${measures.length} detail page(s).`);
  if (measures.length === 0) {
    console.log('No measures rendered. To preview the example, run: node scripts/build.mjs --include-template');
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
