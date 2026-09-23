#!/usr/bin/env node
// One-time (rerunnable) script: backfills authors[].person_id on every measure file
// by matching authors[].name against content/people/*.json's `name` field, after
// normalizing punctuation/prefixes/nicknames. Names with no confident match are
// reported and left untouched rather than guessed.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MEASURES_DIR, PEOPLE_DIR, ROOT } from './validate.mjs';

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/^(dr\.|state sen\.|sen\.|assemblymember|assembly member)\s+/g, '')
    .replace(/["'‘’“”]/g, '')
    .replace(/\((.*?)\)/g, '') // drop parenthetical nicknames like (Suds)
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Manual aliases for cases normalization alone won't bridge (nicknames, honorifics
// mid-name rather than as a prefix).
const ALIASES = {
  'sudhanshu suds jain': 'suds-jain',
  'lucinda cindy langley-andrews': 'lucinda-langley-andrews',
};

const people = readdirSync(PEOPLE_DIR)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => JSON.parse(readFileSync(path.join(PEOPLE_DIR, f), 'utf8')));

const byNormalizedName = new Map();
for (const person of people) {
  byNormalizedName.set(normalize(person.name), person.id);
}

const measureFiles = readdirSync(MEASURES_DIR).filter(
  (f) => f.endsWith('.json') && !f.startsWith('_'),
);

let linked = 0;
let alreadyLinked = 0;
const unmatched = new Set();

for (const file of measureFiles) {
  const full = path.join(MEASURES_DIR, file);
  const measure = JSON.parse(readFileSync(full, 'utf8'));
  if (!measure.authors || measure.authors.length === 0) continue;

  let changed = false;
  for (const author of measure.authors) {
    if (author.person_id) {
      alreadyLinked += 1;
      continue;
    }
    const key = normalize(author.name);
    const id = ALIASES[key] ?? byNormalizedName.get(key);
    if (id) {
      author.person_id = id;
      linked += 1;
      changed = true;
    } else {
      unmatched.add(author.name);
    }
  }

  if (changed) {
    writeFileSync(full, `${JSON.stringify(measure, null, 2)}\n`);
  }
}

console.log(`Linked ${linked} author(s) to a person profile.`);
console.log(`${alreadyLinked} author(s) already had a person_id.`);
if (unmatched.size > 0) {
  console.log(`\nNo matching profile found for ${unmatched.size} name(s) (left as plain text):`);
  for (const name of [...unmatched].sort()) console.log(`  - ${name}`);
}
