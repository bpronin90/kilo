#!/usr/bin/env node
// Rejects new production JavaScript/TypeScript files over 600 lines, growth in
// a file already carrying legacy line-count debt, and stale BASELINE entries
// for files that have already been reduced to the limit, while letting the
// #1046 refactor program shrink that debt card by card without an all-at-once
// rewrite.
//
// A hard cap alone cannot ship on day one: the tree already has 20 files past
// 600 lines, and blocking every PR that merely touches one of them until it is
// fully split would stall unrelated work indefinitely. So this check pins each
// pre-existing offender to its CURRENT line count in BASELINE below. A file
// already over the limit still passes as long as it does not grow past its
// baselined count -- shrinking it (even partially) always passes. A brand-new
// file, or any file not already in BASELINE, is held to the plain 600-line
// limit with no exception. That asymmetry stops the debt from growing.
//
// Ratchet rule: when a baselined file's line count drops to LIMIT or below,
// its BASELINE entry becomes stale and must be removed. This check enforces
// that requirement by failing on any stale entry. Removing the entry graduates
// the file to the plain 600-line guard permanently -- a later PR that tries to
// regrow it past 600 fails as a new violation. The authorized retirement path
// is: include `scripts/check-app-file-lines.mjs` in Allowed Files for the card
// that reduces the file, then delete its BASELINE entry in the same commit.
//
// Usage:
//   node scripts/check-app-file-lines.mjs
//
// Exit codes:
//   0  no file exceeds 600 lines outside the baselined legacy debt below
//   1  a new file (or a baselined file's growth) exceeds the limit
//
// Scope: mobile/**/*.{js,jsx,ts,tsx}, excluding:
//   - tests: `*.test.*` / `*.spec.*` files, and anything under a tests/,
//     __tests__/, __mocks__/, or mocks/ directory
//   - fixtures: anything under a fixtures/ or __fixtures__/ directory
//   - generated/vendor content: node_modules/, .expo/, dist/, build/,
//     coverage/, web-build/, android/, ios/ (native projects Expo can
//     regenerate; not committed today, excluded on principle), and assets/
//     (binary/static content, never application logic)
//   - configuration: files matching *.config.{js,jsx,ts,tsx} (metro, babel,
//     jest, eslint, app.config.js, ...) -- these describe build/tool
//     behavior, not product behavior
//
// Line counts are the number of newline characters in the file, matching
// `wc -l` (the tool used to discover the baseline below). This intentionally
// does not count a final line that lacks a trailing newline, exactly as
// `wc -l` does not, so the two never disagree about where a file stands.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE_DIR = 'mobile';
export const LIMIT = 600;

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

// Any path segment in this set marks the whole subtree as out of scope. The
// walker also uses this to avoid ever descending into node_modules.
const EXCLUDED_DIR_SEGMENTS = new Set([
  'node_modules', '.expo', 'dist', 'build', 'coverage', 'web-build', // generated/vendor output
  'android', 'ios', // generated native projects
  'tests', '__tests__', '__mocks__', 'mocks', // test suites and their doubles
  'fixtures', '__fixtures__', // test fixtures
  'assets', // binary/static content, never application logic
]);

const TEST_FILE_RE = /\.(test|spec)\.(js|jsx|ts|tsx)$/;
const CONFIG_FILE_RE = /\.config\.(js|jsx|ts|tsx)$/;

// Discovered from the tree at the time this guard was added (`git log` for
// this file's history shows when): every `mobile/**/*.js` file over 600 lines,
// paired with its exact `wc -l` count that day. A future card that shrinks one
// of these should lower its number here -- but is never required to as a
// precondition of merging the reduction; see the module comment above.
export const BASELINE = {
  'mobile/components/BackupScreen.js': 650,
  'mobile/components/WeightHistoryList.js': 714,
  'mobile/lib/parser/workoutNote.js': 773,
  'mobile/lib/data/workoutAnalytics.js': 836,
  'mobile/components/UI.js': 894,
  'mobile/screens/WeightScreen.js': 941,
  'mobile/storage/entries/recoveryOperationJournal.js': 993,
  'mobile/App.js': 1191,
  'mobile/screens/AnalyticsScreen.js': 1212,
  'mobile/storage/entries/backupImport.js': 1359,
  'mobile/hooks/entries/recoveryBlockHooks.js': 1366,
  'mobile/screens/log/useLogOtherRoutineEditor.js': 1594,
  'mobile/screens/HomeScreen.js': 1605,
  'mobile/storage/syncQueue.js': 1642,
  'mobile/components/LogRecoverySection.js': 1650,
  'mobile/components/LogScreenEditorCard.js': 1668,
  'mobile/screens/log/useLogCurrentRoutineEditor.js': 1734,
  'mobile/storage/cloud/syncAdapter.js': 1817,
  'mobile/components/AnalyticsRecoverySection.js': 1832,
  'mobile/screens/LogScreen.js': 1864,
};

// `wc -l` counts newline characters, not "lines of text" -- a file with no
// trailing newline is one short of what an editor would show. Matching that
// exactly is what lets BASELINE (built with `wc -l`) and this function always
// agree.
export function countLines(text) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

// relPath is repo-root-relative, forward-slash-separated (e.g. "mobile/App.js").
export function isProductionFile(relPath) {
  const posixPath = relPath.split(sep).join('/');
  if (!posixPath.startsWith(`${SCOPE_DIR}/`)) return false;

  const segments = posixPath.split('/');
  const basename = segments[segments.length - 1];
  if (segments.slice(0, -1).some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment))) return false;

  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex === -1) return false;
  if (!SOURCE_EXTENSIONS.has(basename.slice(dotIndex).toLowerCase())) return false;

  if (TEST_FILE_RE.test(basename)) return false;
  if (CONFIG_FILE_RE.test(basename)) return false;

  return true;
}

// Depth-first walk that never opens an excluded directory (node_modules
// chief among them), so scanning stays fast regardless of how large those
// subtrees are. Returns repo-root-relative, forward-slash paths, sorted.
export function findProductionFiles(scanRoot = root) {
  const out = [];
  const start = join(scanRoot, SCOPE_DIR);

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_SEGMENTS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const relPath = relative(scanRoot, join(dir, entry.name)).split(sep).join('/');
        if (isProductionFile(relPath)) out.push(relPath);
      }
    }
  };
  walk(start);

  return out.sort((a, b) => a.localeCompare(b));
}

// Scans scanRoot's production files and classifies every one over LIMIT as
// either legacy debt (pass) or a regression (fail): a brand-new violation not
// in `baseline`, a baselined file that grew past its allowed count, or a stale
// baseline entry for a file that has already been reduced to LIMIT or below.
export function scan(scanRoot = root, baseline = BASELINE) {
  const files = findProductionFiles(scanRoot);
  const legacy = [];
  const regressions = [];

  for (const relPath of files) {
    let count;
    try {
      count = countLines(readFileSync(join(scanRoot, relPath), 'utf8'));
    } catch (err) {
      throw new Error(`check-app-file-lines: cannot read ${relPath}: ${err.message}`);
    }

    const baselineCount = baseline[relPath];

    if (count <= LIMIT) {
      // Under the limit. If a baseline entry still exists, it is now stale and
      // must be removed so future PRs cannot regrow the file past 600 lines.
      if (baselineCount !== undefined) {
        regressions.push({ kind: 'stale', path: relPath, count, baselineCount });
      }
      continue;
    }

    if (baselineCount === undefined) {
      regressions.push({ kind: 'new', path: relPath, count });
    } else if (count > baselineCount) {
      regressions.push({ kind: 'growth', path: relPath, count, baselineCount });
    } else {
      legacy.push({ path: relPath, count, baselineCount });
    }
  }

  return { files, legacy, regressions, ok: regressions.length === 0 };
}

function pad(count) {
  return String(count).padStart(5, ' ');
}

function describeRegression(regression) {
  if (regression.kind === 'new') {
    return `  NEW      ${pad(regression.count)}  ${regression.path}  (no baseline entry; limit is ${LIMIT} lines)`;
  }
  if (regression.kind === 'stale') {
    return `  STALE    ${pad(regression.count)}  ${regression.path}  (baseline entry ${regression.baselineCount} is stale; file is now at or under the limit — remove this entry from BASELINE)`;
  }
  const grew = regression.count - regression.baselineCount;
  return `  GROWTH   ${pad(regression.count)}  ${regression.path}  (baseline allows ${regression.baselineCount}; grew by ${grew} line(s))`;
}

function describeLegacy(entry) {
  return `  ${pad(entry.count)}  ${entry.path}`;
}

export function report({ files, legacy, regressions, ok }) {
  const lines = [`check-app-file-lines: scanned ${files.length} production file(s) under ${SCOPE_DIR}/.`];

  if (regressions.length > 0) {
    lines.push('', `${regressions.length} regression(s) found (new violation or baseline growth):`);
    for (const regression of regressions.sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(describeRegression(regression));
    }
  }

  if (legacy.length > 0) {
    lines.push(
      '',
      regressions.length > 0
        ? `Legacy debt, unaffected (${legacy.length} file(s), within their baselined count):`
        : `${legacy.length} legacy file(s) remain over the ${LIMIT}-line limit, all within their baselined count (no action required):`,
    );
    for (const entry of legacy.sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(describeLegacy(entry));
    }
  }

  if (ok) {
    lines.push('', legacy.length > 0 ? 'No new violations. No baseline growth.' : `No file exceeds ${LIMIT} lines.`);
  } else {
    const hasStale = regressions.some((r) => r.kind === 'stale');
    const hasNewOrGrowth = regressions.some((r) => r.kind !== 'stale');
    const fixes = [];
    if (hasNewOrGrowth) {
      fixes.push(
        `Shrink the file back to ${LIMIT} lines or fewer, or -- if this is deliberate reduction work -- `
          + 'lower its baseline entry in scripts/check-app-file-lines.mjs. '
          + 'A brand-new file over the limit must be split before merge; this guard never grows the baseline.',
      );
    }
    if (hasStale) {
      fixes.push(
        'For STALE entries: the file has been reduced to the limit or below. '
          + 'Remove its BASELINE entry in scripts/check-app-file-lines.mjs in this same commit. '
          + 'Once removed, future PRs that regrow the file past the limit will fail as new violations.',
      );
    }
    lines.push('', `Fix: ${fixes.join(' ')}`)
  }

  return lines.join('\n');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const result = scan();
  console.log(report(result));
  if (!result.ok) process.exit(1);
}
