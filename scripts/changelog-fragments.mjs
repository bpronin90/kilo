#!/usr/bin/env node

import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { syncVersions } from './sync-version.mjs';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fragmentNameRe = /^([1-9][0-9]*)-([1-9][0-9]*)\.md$/;
const semverRe = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;

export function listFragmentFiles(root = defaultRoot) {
  const names = readdirSync(join(root, '.changes'))
    .filter((name) => name !== 'README.md' && !name.startsWith('.'));
  const invalid = names.find((name) => !fragmentNameRe.test(name));
  if (invalid) throw new Error(`${invalid}: expected <issue>-<sequence>.md`);
  return names.sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
}

export function parseFragment(name, source) {
  const filename = name.match(fragmentNameRe);
  if (!filename) throw new Error(`${name}: expected <issue>-<sequence>.md`);
  const normalized = String(source).replace(/\r\n/g, '\n');
  const match = normalized.match(/^issue: ([1-9][0-9]*)\nbump: (patch|minor)\n\n([^\s][\s\S]*?)\s*$/);
  if (!match) throw new Error(`${name}: expected issue, bump, blank line, and release-note text`);
  const issue = Number(match[1]);
  if (issue !== Number(filename[1])) throw new Error(`${name}: declared issue ${issue} does not match filename`);
  const text = match[3].replace(/\s+/g, ' ').trim();
  return { name, issue, sequence: Number(filename[2]), bump: match[2], text };
}

export function readFragments(root = defaultRoot, names = listFragmentFiles(root)) {
  return names.map((name) => parseFragment(name, readFileSync(join(root, '.changes', name), 'utf8')));
}

export function nextVersion(current, fragments) {
  const match = String(current).match(semverRe);
  if (!match) throw new Error(`Canonical version is not x.y.z: ${current}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major !== 0) throw new Error(`Pre-1.0 release policy cannot calculate from ${current}`);
  if (fragments.length === 0) return current;
  return fragments.some((fragment) => fragment.bump === 'minor')
    ? `0.${minor + 1}.0`
    : `0.${minor}.${patch + 1}`;
}

export function validateFragments(root = defaultRoot) {
  const fragments = readFragments(root);
  const keys = new Set();
  for (const fragment of fragments) {
    const key = `${fragment.issue}-${fragment.sequence}`;
    if (keys.has(key)) throw new Error(`Duplicate fragment key: ${key}`);
    keys.add(key);
  }
  return fragments;
}

export function prepareRelease({
  root = defaultRoot,
  date = new Date().toISOString().slice(0, 10),
  fragmentNames = listFragmentFiles(root),
  logger = console,
} = {}) {
  const fragments = readFragments(root, fragmentNames);
  if (fragments.length === 0) return { changed: false, fragments: [], version: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Release date must be YYYY-MM-DD: ${date}`);

  const changelogPath = join(root, 'CHANGELOG.md');
  const changelog = readFileSync(changelogPath, 'utf8');
  if (!changelog.startsWith('# Changelog\n')) throw new Error('CHANGELOG.md must begin with "# Changelog"');

  const packagePath = join(root, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const version = nextVersion(packageJson.version, fragments);
  packageJson.version = version;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  syncVersions({ root, logger });

  const bullets = fragments.map((fragment) => `- Issue #${fragment.issue}: ${fragment.text}`).join('\n');
  const entry = `## ${version} - ${date}\n\n${bullets}\n\n`;
  writeFileSync(changelogPath, changelog.replace(/^# Changelog\n\n?/, `# Changelog\n\n${entry}`));

  for (const name of fragmentNames) rmSync(join(root, '.changes', name));
  logger.log(`Prepared ${version} from ${fragments.length} changelog fragment(s).`);
  return { changed: true, fragments, version };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2] ?? 'check';
    if (command === 'check') {
      const fragments = validateFragments();
      console.log(`Validated ${fragments.length} changelog fragment(s).`);
    } else if (command === 'prepare') {
      const result = prepareRelease({ date: argumentValue('--date') ?? undefined });
      if (!result.changed) console.log('No changelog fragments are pending.');
    } else {
      throw new Error('Usage: changelog-fragments.mjs <check|prepare> [--date YYYY-MM-DD]');
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
