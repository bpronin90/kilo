#!/usr/bin/env node
// Keeps the mobile app's version values aligned with the canonical root
// package.json version. The displayed version (mobile/package.json) and the
// OTA runtime boundary (mobile/app.json expo.version) must mirror the root.
//
// Usage:
//   node scripts/sync-version.mjs          Write the canonical version into the mobile files.
//   node scripts/sync-version.mjs --check  Exit non-zero if any mobile file is out of sync (CI guard).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const targets = [
  { path: join(root, 'mobile', 'package.json'), label: 'mobile/package.json' },
  { path: join(root, 'mobile', 'app.json'), label: 'mobile/app.json' },
];

const check = process.argv.includes('--check');
// Matches the first top-level "version": "x.y.z" field. In package.json that is
// the package version; in app.json that is expo.version. Dependency entries are
// keyed by name (not "version"), and "runtimeVersion" does not match.
const versionRe = /("version"\s*:\s*")([^"]*)(")/;

let drift = false;
for (const target of targets) {
  const text = readFileSync(target.path, 'utf8');
  const match = text.match(versionRe);
  if (!match) {
    console.error(`No "version" field found in ${target.label}`);
    process.exitCode = 1;
    continue;
  }
  const current = match[2];
  if (current === canonical) continue;

  drift = true;
  if (check) {
    console.error(`Version drift: ${target.label} is ${current}, expected ${canonical}`);
  } else {
    writeFileSync(target.path, text.replace(versionRe, `$1${canonical}$3`));
    console.log(`Updated ${target.label}: ${current} -> ${canonical}`);
  }
}

if (check && drift) {
  console.error(`\nRun "node scripts/sync-version.mjs" to align mobile versions to ${canonical}.`);
  process.exit(1);
}
if (!check && !drift) {
  console.log(`All mobile version files already at ${canonical}.`);
}
