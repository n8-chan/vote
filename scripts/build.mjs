#!/usr/bin/env node
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  listMeasureFiles,
  listPersonFiles,
  listRaceFiles,
  readMeasureFile,
  readPersonFile,
  readRaceFile,
  ROOT,
} from './validate.mjs';

const DIST = path.join(ROOT, 'dist');
const SITE_TITLE = 'California Propositions, Santa Clara County Ballot Measures, and Races';

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

function authorList(authors, peopleById) {
  if (!authors || authors.length === 0) return '<p class="empty">No author on record.</p>';
  const items = authors
    .map((author) => {
      const person = author.person_id ? peopleById.get(author.person_id) : null;
      const name = person
        ? `<a href="../people/${esc(person.id)}.html">${esc(author.name)}</a>`
        : esc(author.name);
      return `<li><strong>${name}</strong> <span class="party-type">${esc(author.role)}</span></li>`;
    })
    .join('\n');
  return `<ul class="parties">\n${items}\n</ul>`;
}

function donorList(donors) {
  if (!donors || donors.length === 0) return '<p class="empty">No donor-level breakdown found.</p>';
  const items = donors
    .map((donor) => `<li>${esc(donor.name)} <span class="amount">${esc(donor.amount)}</span></li>`)
    .join('\n');
  return `<ul class="donors">\n${items}\n</ul>`;
}

function committeeList(committees) {
  if (!committees || committees.length === 0) return '<p class="empty">No registered committees found.</p>';
  const items = committees
    .map(
      (c) =>
        `<li><strong>${esc(c.name)}</strong> <span class="party-type">${esc(c.total_raised)}</span>${donorList(c.top_donors)}<p class="source-link">${link(c.source_url, 'Filing source')}</p></li>`,
    )
    .join('\n');
  return `<ul class="parties committees">\n${items}\n</ul>`;
}

/** Detail-page sections, rendered top to bottom in this order. */
const SECTIONS = [
  { heading: 'Summary', render: (m) => paragraphs([m.summary]) },
  {
    heading: 'Who Wrote This',
    when: (m) => m.authors && m.authors.length > 0,
    render: (m, ctx) => authorList(m.authors, ctx.peopleById),
  },
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
    heading: "Who's Paying for Ads",
    when: (m) => m.funding && ((m.funding.support_committees?.length ?? 0) + (m.funding.oppose_committees?.length ?? 0) > 0),
    render: (m) =>
      `<div class="columns">\n<div class="column supports"><h3>Supporting committees</h3>${committeeList(m.funding.support_committees)}</div>\n<div class="column opposes"><h3>Opposing committees</h3>${committeeList(m.funding.oppose_committees)}</div>\n</div>`,
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

function renderDetail(measure, { isTemplate, peopleById }) {
  const banner = isTemplate
    ? '<p class="template-warning">This is the example template, not a real measure. Every fact below is made up.</p>'
    : '';
  const ctx = { peopleById };
  const sections = SECTIONS.filter((section) => !section.when || section.when(measure))
    .map((section) => `<section>\n<h2>${esc(section.heading)}</h2>\n${section.render(measure, ctx)}\n</section>`)
    .join('\n');

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

const LEVEL_LABELS = {
  federal: 'Federal',
  state: 'California statewide',
  county: 'County',
  local: 'Local',
};

function raceCard(race) {
  const names = race.candidates.map((c) => `${c.name} (${c.party})`).join(' vs. ');
  return `<li class="card">
<p class="badges"><span class="badge jurisdiction">${esc(LEVEL_LABELS[race.level] ?? race.level)}</span></p>
<h3><a href="races/${esc(race.id)}.html">${esc(race.office)}</a></h3>
<p class="card-summary">${esc(names)}</p>
<p class="card-meta">Election ${esc(race.election_date)}</p>
</li>`;
}

function raceSection(races) {
  const sorted = [...races].sort(
    (a, b) =>
      a.election_date.localeCompare(b.election_date) || a.ballot_order - b.ballot_order,
  );
  const contents =
    sorted.length === 0
      ? '<p class="empty">No races tracked yet.</p>'
      : `<ul class="cards">\n${sorted.map(raceCard).join('\n')}\n</ul>`;
  return `<section>\n<h2>Races for Office</h2>\n<p class="blurb">Candidates on the ballot, compared side by side.</p>\n${contents}\n</section>`;
}

function renderIndex(measures, races) {
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
<p><a href="people/index.html">Browse candidates, authors, and proponents →</a></p>
</header>
${raceSection(races)}
${groups}
<footer>
<p>Every word of analysis on this site is written by a person. The build scripts only check structure and render it.</p>
</footer>`;

  return page({
    title: SITE_TITLE,
    description:
      'Deep-dive analysis of California statewide propositions, Santa Clara County ballot measures, and the races for office on the same ballot.',
    stylesheet: 'style.css',
    body,
  });
}

const PERSON_TYPE_LABELS = {
  state_legislator: 'State legislator',
  county_official: 'County official',
  city_official: 'City official',
  school_district_official: 'School district official',
  special_district_official: 'Special district official',
  initiative_proponent: 'Initiative proponent',
  statewide_official: 'Statewide official',
  federal_official: 'Federal official',
  candidate: 'Candidate',
  other: 'Other',
};

function pastMeasuresList(items) {
  if (!items || items.length === 0) return '<p class="empty">None on record.</p>';
  const rows = items
    .map(
      (m) =>
        `<li>${link(m.source_url, m.title)} <span class="card-meta">${esc(m.year)} — ${esc(m.outcome)}</span></li>`,
    )
    .join('\n');
  return `<ul class="sources">\n${rows}\n</ul>`;
}

function candidacyList(races) {
  const items = races
    .map(
      (race) =>
        `<li><a href="../races/${esc(race.id)}.html">${esc(race.office)}</a> <span class="card-meta">Election ${esc(race.election_date)}</span></li>`,
    )
    .join('\n');
  return `<ul class="sources">\n${items}\n</ul>`;
}

const PERSON_SECTIONS = [
  {
    heading: 'On the Ballot',
    when: (p, ctx) => ctx.racesByPerson.has(p.id),
    render: (p, ctx) => candidacyList(ctx.racesByPerson.get(p.id)),
  },
  { heading: 'Background', when: (p) => p.background.length > 0, render: (p) => paragraphs(p.background) },
  {
    heading: 'Committee Memberships',
    when: (p) => p.committee_memberships?.length > 0,
    render: (p) => bullets(p.committee_memberships),
  },
  {
    heading: 'Voting Record Highlights',
    when: (p) => p.voting_record_highlights?.length > 0,
    render: (p) => bullets(p.voting_record_highlights),
  },
  { heading: 'Attendance', when: (p) => !!p.attendance, render: (p) => paragraphs([p.attendance]) },
  {
    heading: 'Endorsements Received',
    when: (p) => p.endorsements_received?.length > 0,
    render: (p) => parties(p.endorsements_received),
  },
  {
    heading: 'Past Measures Authored',
    when: (p) => p.past_measures_authored?.length > 0,
    render: (p) => pastMeasuresList(p.past_measures_authored),
  },
  {
    heading: 'Sources',
    render: (p) =>
      `<ul class="sources">\n${p.sources
        .map((s) => `<li>${link(s.url, s.title)} <span class="retrieved">retrieved ${esc(s.retrieved)}</span></li>`)
        .join('\n')}\n</ul>`,
  },
];

function renderPerson(person, { isTemplate, racesByPerson }) {
  const banner = isTemplate
    ? '<p class="template-warning">This is the example template, not a real person. Every fact below is made up.</p>'
    : '';
  const ctx = { racesByPerson };
  const sections = PERSON_SECTIONS.filter((section) => !section.when || section.when(person, ctx))
    .map((section) => `<section>\n<h2>${esc(section.heading)}</h2>\n${section.render(person, ctx)}\n</section>`)
    .join('\n');

  const factRows = [['Role', person.title]];
  if (person.district) factRows.push(['District', person.district]);
  if (person.years_of_service) factRows.push(['Years of service', person.years_of_service]);

  const body = `<a class="back" href="../index.html">Back to all measures</a>
<article>
<header class="measure-header">
${banner}
<p class="eyebrow">${esc(PERSON_TYPE_LABELS[person.type] ?? person.type)}</p>
<h1>${esc(person.name)}</h1>
${facts(factRows)}
</header>
${sections}
</article>
<footer>
<p>Last updated ${esc(person.last_updated)}.</p>
<p><a class="back" href="../people/index.html">Back to all people</a></p>
</footer>`;

  return page({
    title: person.name,
    description: person.title,
    stylesheet: '../style.css',
    body,
  });
}

function renderPeopleIndex(people) {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const items = sorted
    .map(
      (p) => `<li class="card">
<p class="badges"><span class="badge jurisdiction">${esc(PERSON_TYPE_LABELS[p.type] ?? p.type)}</span></p>
<h3><a href="${esc(p.id)}.html">${esc(p.name)}</a></h3>
<p class="card-summary">${esc(p.title)}</p>
</li>`,
    )
    .join('\n');
  const contents = sorted.length === 0 ? '<p class="empty">No profiles yet.</p>' : `<ul class="cards">\n${items}\n</ul>`;

  const body = `<header class="site-header">
<h1>People</h1>
<p class="blurb">Every candidate in a tracked race and everyone credited as an author or proponent on a tracked measure, with their record.</p>
</header>
<section>${contents}</section>
<footer>
<p><a class="back" href="../index.html">Back to all measures</a></p>
</footer>`;

  return page({
    title: 'People — candidates, authors, and proponents',
    description: 'Profiles of candidates in tracked races and the legislators and proponents behind tracked ballot measures.',
    stylesheet: '../style.css',
    body,
  });
}

function candidateColumn(candidate, peopleById) {
  const person = candidate.person_id ? peopleById.get(candidate.person_id) : null;
  const name = person ? `<a href="../people/${esc(person.id)}.html">${esc(candidate.name)}</a>` : esc(candidate.name);
  const rows = [['Party', candidate.party], ['Incumbent', candidate.incumbent ? 'Yes' : 'No']];
  if (candidate.primary_result) rows.push(['Primary', candidate.primary_result]);
  const positions =
    candidate.positions.length === 0
      ? '<p class="empty">No stated positions found.</p>'
      : `<ul>\n${candidate.positions
          .map((pos) => `<li><strong>${esc(pos.issue)}:</strong> ${esc(pos.stance)}</li>`)
          .join('\n')}\n</ul>`;
  return `<div class="column"><h3>${name}</h3>\n${facts(rows)}\n${positions}</div>`;
}

function pollList(polls) {
  const items = polls
    .map(
      (poll) =>
        `<li><strong>${esc(poll.pollster)}</strong> <span class="card-meta">${esc(poll.dates)}</span><p>${esc(poll.result)}</p><p class="source-link">${link(poll.url, 'Poll source')}</p></li>`,
    )
    .join('\n');
  return `<ul class="analysis">\n${items}\n</ul>`;
}

/** Race-page sections, rendered top to bottom in this order. */
const RACE_SECTIONS = [
  { heading: 'Summary', render: (r) => paragraphs([r.summary]) },
  {
    heading: 'The Candidates',
    render: (r, ctx) =>
      `<div class="columns">\n${r.candidates.map((c) => candidateColumn(c, ctx.peopleById)).join('\n')}\n</div>`,
  },
  { heading: 'Key Differences', render: (r) => bullets(r.key_differences) },
  { heading: 'Polling', when: (r) => r.polling?.length > 0, render: (r) => pollList(r.polling) },
  {
    heading: 'Sources',
    render: (r) =>
      `<ul class="sources">\n${r.sources
        .map((s) => `<li>${link(s.url, s.title)} <span class="retrieved">retrieved ${esc(s.retrieved)}</span></li>`)
        .join('\n')}\n</ul>`,
  },
];

function renderRace(race, { isTemplate, peopleById }) {
  const banner = isTemplate
    ? '<p class="template-warning">This is the example template, not a real race. Every fact below is made up.</p>'
    : '';
  const ctx = { peopleById };
  const sections = RACE_SECTIONS.filter((section) => !section.when || section.when(race, ctx))
    .map((section) => `<section>\n<h2>${esc(section.heading)}</h2>\n${section.render(race, ctx)}\n</section>`)
    .join('\n');

  const body = `<a class="back" href="../index.html">Back to the ballot</a>
<article>
<header class="measure-header">
${banner}
<p class="eyebrow">${esc(LEVEL_LABELS[race.level] ?? race.level)} race</p>
<h1>${esc(race.office)}</h1>
${facts([
  ['Election', race.election_date],
  ['Identifier', race.id],
])}
</header>
${sections}
</article>
<footer>
<p>Last updated ${esc(race.last_updated)}.</p>
<p><a class="back" href="../index.html">Back to the ballot</a></p>
</footer>`;

  return page({
    title: race.office,
    description: race.summary,
    stylesheet: '../style.css',
    body,
  });
}

function loadAll(kind, files, readFile, idOf) {
  const entries = [];
  const failures = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const { errors, ...rest } = readFile(file);
    const record = rest[kind];
    if (errors.length > 0) {
      failures.push(`${rel}\n${errors.map((error) => `       ${error}`).join('\n')}`);
      continue;
    }
    entries.push({ [kind]: record, isTemplate: path.basename(file).startsWith('_') });
  }
  if (failures.length === 0) {
    const ids = new Set();
    for (const entry of entries) {
      const id = idOf(entry[kind]);
      if (ids.has(id)) {
        failures.push(`duplicate ${kind} id "${id}"`);
        continue;
      }
      ids.add(id);
    }
  }
  return { entries, failures };
}

function main(argv) {
  const includeTemplate = argv.includes('--include-template');

  const measureLoad = loadAll(
    'measure',
    listMeasureFiles({ includeTemplate }),
    readMeasureFile,
    (m) => m.id,
  );
  const personLoad = loadAll('person', listPersonFiles({ includeTemplate }), readPersonFile, (p) => p.id);
  const raceLoad = loadAll('race', listRaceFiles({ includeTemplate }), readRaceFile, (r) => r.id);
  const failures = [...measureLoad.failures, ...personLoad.failures, ...raceLoad.failures];

  if (failures.length > 0) {
    console.error(`Build aborted: ${failures.length} file(s) failed validation.\n`);
    for (const failure of failures) console.error(`FAIL ${failure}\n`);
    console.error('Fix the files above, or run `npm run validate` to see the full list.');
    return 1;
  }

  const measures = measureLoad.entries;
  const people = personLoad.entries;
  const peopleById = new Map(people.map(({ person }) => [person.id, person]));
  const races = raceLoad.entries;
  const racesByPerson = new Map();
  for (const { race } of races) {
    for (const candidate of race.candidates) {
      if (!candidate.person_id) continue;
      if (!racesByPerson.has(candidate.person_id)) racesByPerson.set(candidate.person_id, []);
      racesByPerson.get(candidate.person_id).push(race);
    }
  }

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(path.join(DIST, 'measures'), { recursive: true });
  mkdirSync(path.join(DIST, 'people'), { recursive: true });
  mkdirSync(path.join(DIST, 'races'), { recursive: true });
  copyFileSync(path.join(ROOT, 'public', 'style.css'), path.join(DIST, 'style.css'));

  writeFileSync(
    path.join(DIST, 'index.html'),
    renderIndex(measures.map((entry) => entry.measure), races.map((entry) => entry.race)),
  );
  for (const { measure, isTemplate } of measures) {
    writeFileSync(
      path.join(DIST, 'measures', `${measure.id}.html`),
      renderDetail(measure, { isTemplate, peopleById }),
    );
  }

  writeFileSync(path.join(DIST, 'people', 'index.html'), renderPeopleIndex(people.map((entry) => entry.person)));
  for (const { person, isTemplate } of people) {
    writeFileSync(path.join(DIST, 'people', `${person.id}.html`), renderPerson(person, { isTemplate, racesByPerson }));
  }

  for (const { race, isTemplate } of races) {
    writeFileSync(path.join(DIST, 'races', `${race.id}.html`), renderRace(race, { isTemplate, peopleById }));
  }

  console.log(
    `Built dist/index.html, ${measures.length} measure page(s), ${people.length} person page(s), and ${races.length} race page(s).`,
  );
  if (measures.length === 0 && people.length === 0) {
    console.log('Nothing rendered. To preview the examples, run: node scripts/build.mjs --include-template');
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
