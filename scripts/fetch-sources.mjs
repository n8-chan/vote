#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listMeasureFiles, MEASURES_DIR, ROOT } from './validate.mjs';

const SOURCES_DIR = path.join(ROOT, 'content', 'sources');
const TIMEOUT_MS = 30_000;
const USER_AGENT = 'vote-ballot-tracker/0.1 (static site source archiver)';

const EXTENSIONS = [
  ['application/pdf', '.pdf'],
  ['application/json', '.json'],
  ['text/html', '.html'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/xml', '.xml'],
  ['text/xml', '.xml'],
];

function extensionFor(contentType) {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS.find(([mime]) => mime === type)?.[1] ?? '.bin';
}

function slug(title) {
  const cleaned = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return cleaned || 'source';
}

/**
 * Real measures live at content/measures/<id>.json. The fallback scan exists so that
 * _TEMPLATE.json, whose filename deliberately differs from its id, is still reachable.
 */
function resolveMeasureFile(id) {
  const direct = path.join(MEASURES_DIR, `${id}.json`);
  if (existsSync(direct)) return direct;
  return (
    listMeasureFiles({ includeTemplate: true }).find((file) => {
      try {
        return JSON.parse(readFileSync(file, 'utf8')).id === id;
      } catch {
        return false;
      }
    }) ?? null
  );
}

async function archive(source, index, outDir) {
  const retrieved_at = new Date().toISOString();
  const name = `${String(index + 1).padStart(2, '0')}-${slug(source.title)}`;

  const response = await fetch(source.url, {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = Buffer.from(await response.arrayBuffer());
  const saved_as = `${name}${extensionFor(response.headers.get('content-type'))}`;
  writeFileSync(path.join(outDir, saved_as), body);

  if (!response.ok) {
    console.error(`  warning: ${source.url} returned HTTP ${response.status}; body saved anyway`);
  }
  console.log(`  saved ${saved_as} (HTTP ${response.status}, ${body.length} bytes)`);

  return { url: source.url, title: source.title, retrieved_at, saved_as, http_status: response.status };
}

async function main(argv) {
  const id = argv[0];
  if (!id || id.startsWith('-')) {
    console.error('Usage: node scripts/fetch-sources.mjs <measure-id>');
    console.error('Example: node scripts/fetch-sources.mjs ca-prop-1-2026');
    return 1;
  }

  const measureFile = resolveMeasureFile(id);
  if (!measureFile) {
    console.error(`No measure with id "${id}" in ${path.relative(ROOT, MEASURES_DIR)}.`);
    return 1;
  }

  let measure;
  try {
    measure = JSON.parse(readFileSync(measureFile, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${path.relative(ROOT, measureFile)}: ${error.message}`);
    return 1;
  }

  const sources = Array.isArray(measure.sources) ? measure.sources : [];
  if (sources.length === 0) {
    console.error(`${id} lists no sources to fetch.`);
    return 1;
  }

  const outDir = path.join(SOURCES_DIR, id);
  mkdirSync(outDir, { recursive: true });

  console.log(`Archiving ${sources.length} source(s) for ${id} into ${path.relative(ROOT, outDir)}`);

  const manifest = [];
  let failed = 0;
  for (const [index, source] of sources.entries()) {
    try {
      manifest.push(await archive(source, index, outDir));
    } catch (error) {
      failed += 1;
      console.error(`  failed ${source.url}: ${error.message}`);
      manifest.push({
        url: source.url,
        title: source.title,
        retrieved_at: new Date().toISOString(),
        saved_as: null,
        http_status: null,
        error: error.message,
      });
    }
  }

  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, path.join(outDir, 'manifest.json'))}.`);
  console.log(`${sources.length - failed}/${sources.length} source(s) archived.`);
  return failed === 0 ? 0 : 1;
}

process.exit(await main(process.argv.slice(2)));
