#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MEASURES_DIR = path.join(ROOT, 'content', 'measures');
export const PEOPLE_DIR = path.join(ROOT, 'content', 'people');

const MEASURE_SCHEMA = JSON.parse(readFileSync(path.join(ROOT, 'schema', 'measure.schema.json'), 'utf8'));
const PERSON_SCHEMA = JSON.parse(readFileSync(path.join(ROOT, 'schema', 'person.schema.json'), 'utf8'));

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function childPath(at, key) {
  return at ? `${at}.${key}` : key;
}

function label(at) {
  return at || '(root)';
}

function resolve(node, schema) {
  if (!node.$ref) return node;
  const target = node.$ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((acc, segment) => acc?.[segment], schema);
  if (!target) throw new Error(`schema has an unresolvable $ref: ${node.$ref}`);
  return target;
}

function check(value, rawNode, at, errors, schema) {
  const node = resolve(rawNode, schema);
  const actual = typeOf(value);

  if (node.type) {
    const expected = Array.isArray(node.type) ? node.type : [node.type];
    if (!expected.includes(actual)) {
      errors.push(`${label(at)}: expected ${expected.join(' or ')}, got ${actual}`);
      return;
    }
  }

  if (node.enum && !node.enum.includes(value)) {
    const allowed = node.enum.map((v) => JSON.stringify(v)).join(', ');
    errors.push(`${label(at)}: must be one of ${allowed}, got ${JSON.stringify(value)}`);
  }

  if ('const' in node && value !== node.const) {
    errors.push(`${label(at)}: must equal ${JSON.stringify(node.const)}`);
  }

  if (actual === 'string') {
    if (node.minLength === 1 && value.length < 1) {
      errors.push(`${label(at)}: must not be empty`);
    } else if (node.minLength > 1 && value.length < node.minLength) {
      errors.push(`${label(at)}: must be at least ${node.minLength} characters`);
    }
    if (node.pattern && !new RegExp(node.pattern).test(value)) {
      errors.push(`${label(at)}: ${JSON.stringify(value)} does not match ${node.pattern}`);
    }
  }

  if (actual === 'array') {
    if (node.minItems !== undefined && value.length < node.minItems) {
      errors.push(`${label(at)}: needs at least ${node.minItems} item(s), got ${value.length}`);
    }
    if (node.items) {
      value.forEach((item, index) => check(item, node.items, `${at}[${index}]`, errors, schema));
    }
  }

  if (actual === 'object') {
    for (const name of node.required ?? []) {
      if (!(name in value)) errors.push(`${childPath(at, name)}: missing required property`);
    }
    for (const [name, sub] of Object.entries(node.properties ?? {})) {
      if (name in value) check(value[name], sub, childPath(at, name), errors, schema);
    }
  }

  for (const sub of node.allOf ?? []) check(value, sub, at, errors, schema);

  if (node.if) {
    const branch = matches(value, node.if, schema) ? node.then : node.else;
    if (branch) check(value, branch, at, errors, schema);
  }
}

function matches(value, node, schema) {
  const probe = [];
  check(value, node, '', probe, schema);
  return probe.length === 0;
}

/** Returns a list of human-readable problems; an empty list means the measure is valid. */
export function validateMeasure(measure) {
  const errors = [];
  check(measure, MEASURE_SCHEMA, '', errors, MEASURE_SCHEMA);
  return errors;
}

/** Returns a list of human-readable problems; an empty list means the person profile is valid. */
export function validatePerson(person) {
  const errors = [];
  check(person, PERSON_SCHEMA, '', errors, PERSON_SCHEMA);
  return errors;
}

/**
 * Measure files in content/measures, sorted. Files whose name starts with "_" are
 * scaffolding (_TEMPLATE.json) and stay out of the site unless includeTemplate is set.
 */
export function listMeasureFiles({ includeTemplate = false } = {}) {
  let names;
  try {
    names = readdirSync(MEASURES_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .filter((name) => includeTemplate || !name.startsWith('_'))
    .sort()
    .map((name) => path.join(MEASURES_DIR, name));
}

export function readMeasureFile(file) {
  let measure;
  try {
    measure = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { measure: null, errors: [`(file): not valid JSON: ${error.message}`] };
  }
  return { measure, errors: validateMeasure(measure) };
}

/**
 * Person files in content/people, sorted. Files whose name starts with "_" are
 * scaffolding (_TEMPLATE.json) and stay out of the site unless includeTemplate is set.
 */
export function listPersonFiles({ includeTemplate = false } = {}) {
  let names;
  try {
    names = readdirSync(PEOPLE_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .filter((name) => includeTemplate || !name.startsWith('_'))
    .sort()
    .map((name) => path.join(PEOPLE_DIR, name));
}

export function readPersonFile(file) {
  let person;
  try {
    person = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { person: null, errors: [`(file): not valid JSON: ${error.message}`] };
  }
  return { person, errors: validatePerson(person) };
}

function validateSet(kind, files, readFile) {
  if (files.length === 0) return { checked: 0, failed: 0 };
  let failed = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const { errors } = readFile(file);
    if (errors.length === 0) {
      console.log(`ok   ${rel}`);
      continue;
    }
    failed += 1;
    console.log(`FAIL ${rel}`);
    for (const error of errors) console.log(`       ${error}`);
  }
  console.log(`${files.length - failed}/${files.length} ${kind} file(s) valid.\n`);
  return { checked: files.length, failed };
}

function main(argv) {
  const includeTemplate = argv.includes('--include-template');
  const measureFiles = listMeasureFiles({ includeTemplate });
  const personFiles = listPersonFiles({ includeTemplate });

  if (measureFiles.length === 0 && personFiles.length === 0) {
    const hint = includeTemplate ? '' : ' Pass --include-template to also check the _TEMPLATE.json files.';
    console.log(`No measure or person files to validate.${hint}`);
    return 0;
  }

  const measures = validateSet('measure', measureFiles, readMeasureFile);
  const people = validateSet('person', personFiles, readPersonFile);

  return measures.failed === 0 && people.failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
