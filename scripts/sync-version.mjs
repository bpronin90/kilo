#!/usr/bin/env node
// Keeps every packaged app version aligned with the canonical root package.json.
// Usage:
//   node scripts/sync-version.mjs          Write synchronized versions.
//   node scripts/sync-version.mjs --check  Fail if any synchronized version drifts.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const versionRe = /("version"\s*:\s*")([^"]*)(")/;

export function syncVersions({ root = defaultRoot, check = false, logger = console } = {}) {
  const canonical = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const drift = [];
  const textTargets = [
    { path: join(root, 'mobile', 'package.json'), label: 'mobile/package.json' },
    { path: join(root, 'mobile', 'app.json'), label: 'mobile/app.json' },
  ];

  for (const target of textTargets) {
    const source = readFileSync(target.path, 'utf8');
    const match = source.match(versionRe);
    if (!match) throw new Error(`No "version" field found in ${target.label}`);
    if (match[2] === canonical) continue;
    drift.push({ label: target.label, from: match[2], to: canonical });
    if (!check) writeFileSync(target.path, source.replace(versionRe, `$1${canonical}$3`));
  }

  const lockTargets = [
    { path: join(root, 'package-lock.json'), label: 'package-lock.json' },
    { path: join(root, 'mobile', 'package-lock.json'), label: 'mobile/package-lock.json' },
  ];
  for (const target of lockTargets) {
    const lock = JSON.parse(readFileSync(target.path, 'utf8'));
    const packageRoot = lock.packages?.[''];
    if (lock.version === canonical && (!packageRoot || packageRoot.version === canonical)) continue;
    drift.push({ label: target.label, from: lock.version, to: canonical });
    if (!check) {
      lock.version = canonical;
      if (packageRoot) packageRoot.version = canonical;
      writeFileSync(target.path, `${JSON.stringify(lock, null, 2)}\n`);
    }
  }

  if (check && drift.length > 0) {
    const details = drift.map(({ label, from, to }) => `${label} is ${from}, expected ${to}`).join('; ');
    throw new Error(`Version drift: ${details}. Run "node scripts/sync-version.mjs".`);
  }
  if (!check) {
    for (const item of drift) logger.log(`Updated ${item.label}: ${item.from} -> ${item.to}`);
    if (drift.length === 0) logger.log(`All version files already at ${canonical}.`);
  }
  return { canonical, drift };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    syncVersions({ check: process.argv.includes('--check') });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
