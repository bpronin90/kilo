#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_DIR = process.env.KILO_SUPABASE_WORKDIR
  ? path.resolve(process.env.KILO_SUPABASE_WORKDIR)
  : ROOT;
const TEST_DIR = path.join(PROJECT_DIR, 'supabase', 'tests');
const PGTAP_PLAN = /\bselect\s+plan\s*\(/i;

export function discoverPgTapFiles(testDir = TEST_DIR) {
  return readdirSync(testDir, { withFileTypes: true })
    .filter((entry) => (
      entry.isFile()
      && entry.name.endsWith('.sql')
      && PGTAP_PLAN.test(readFileSync(path.join(testDir, entry.name), 'utf8'))
    ))
    .map((entry) => path.join(testDir, entry.name))
    .sort();
}

export function tapOutputHasDisallowedDirective(output) {
  return /^\s*(?:ok|not ok)\b.*#\s*(?:skip|todo)\b/im.test(output)
    || /^\s*1\.\.0\b/im.test(output)
    || /^\s*bail out!/im.test(output)
    || /\b(?:no plan found|parse errors?|dubious, test returned|aborted)\b/i.test(output);
}

export function runPgTapSuite({
  files = discoverPgTapFiles(),
  run = (file) => spawnSync(
    'supabase',
    ['test', 'db', '--local', path.relative(PROJECT_DIR, file)],
    { cwd: PROJECT_DIR, encoding: 'utf8' },
  ),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (files.length === 0) {
    throw new Error('No pgTAP test files were discovered.');
  }

  let failed = false;
  for (const file of files) {
    const relativeFile = path.relative(PROJECT_DIR, file);
    stdout.write(`\n=== ${relativeFile} ===\n`);
    const result = run(file);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.stdout) stdout.write(result.stdout);
    if (result.stderr) stderr.write(result.stderr);

    if (result.error) {
      stderr.write(`${relativeFile}: ${result.error.message}\n`);
      failed = true;
    } else if (result.status !== 0) {
      stderr.write(`${relativeFile}: pgTAP exited with status ${result.status}.\n`);
      failed = true;
    } else if (tapOutputHasDisallowedDirective(output)) {
      stderr.write(`${relativeFile}: skipped, TODO, or aborted pgTAP output is not allowed.\n`);
      failed = true;
    }
  }

  if (failed) {
    throw new Error('One or more pgTAP files did not complete cleanly.');
  }
  stdout.write(`\nAll ${files.length} pgTAP files completed without failures, skips, TODOs, or aborts.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runPgTapSuite();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
