import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { LIMIT, countLines, isProductionFile, findProductionFiles, scan, report, validateBaseline } from './check-app-file-lines.mjs';

// Content whose `wc -l` (and countLines) is exactly `n`: `n` newline-terminated
// lines, so there is no ambiguity about a missing trailing newline.
function linesOf(n) {
  return 'const x = 1;\n'.repeat(n);
}

function fixture() {
  return mkdtempSync(join(tmpdir(), 'kilo-app-lines-'));
}

function put(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return relPath;
}

test('countLines matches `wc -l`: counts newlines, not trailing partial lines', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('one line, no trailing newline'), 0);
  assert.equal(countLines('one line\n'), 1);
  assert.equal(countLines('a\nb\nc\n'), 3);
  assert.equal(countLines('a\nb\nc'), 2);
});

test('600 lines passes and 601 lines fails: the limit is inclusive', () => {
  const root = fixture();
  put(root, 'mobile/atLimit.js', linesOf(LIMIT));
  put(root, 'mobile/overLimit.js', linesOf(LIMIT + 1));

  const result = scan(root, {});
  assert.deepEqual(result.files.sort(), ['mobile/atLimit.js', 'mobile/overLimit.js']);
  assert.equal(result.ok, false);
  assert.equal(result.regressions.length, 1);
  assert.equal(result.regressions[0].path, 'mobile/overLimit.js');
  assert.equal(result.regressions[0].count, LIMIT + 1);
  assert.equal(result.regressions[0].kind, 'new');
});

test('a brand-new file over the limit with no baseline entry fails as a new violation', () => {
  const root = fixture();
  put(root, 'mobile/screens/NewScreen.js', linesOf(650));

  const result = scan(root, {});
  assert.equal(result.ok, false);
  assert.equal(result.regressions.length, 1);
  assert.deepEqual(result.regressions[0], { kind: 'new', path: 'mobile/screens/NewScreen.js', count: 650 });
});

test('a baselined file that grew past its allowed count fails as growth, not as new', () => {
  const root = fixture();
  put(root, 'mobile/lib/big.js', linesOf(720));

  const result = scan(root, { 'mobile/lib/big.js': 700 });
  assert.equal(result.ok, false);
  assert.equal(result.regressions.length, 1);
  assert.deepEqual(
    result.regressions[0],
    { kind: 'growth', path: 'mobile/lib/big.js', count: 720, baselineCount: 700 },
  );
  assert.equal(result.legacy.length, 0);
});

test('a baselined file that shrank, but is still over the limit, passes as legacy debt', () => {
  const root = fixture();
  put(root, 'mobile/lib/big.js', linesOf(650));

  const result = scan(root, { 'mobile/lib/big.js': 700 });
  assert.equal(result.ok, true);
  assert.equal(result.regressions.length, 0);
  assert.deepEqual(result.legacy, [{ path: 'mobile/lib/big.js', count: 650, baselineCount: 700 }]);
});

test('a baselined file that shrank to exactly the baselined count still passes', () => {
  const root = fixture();
  put(root, 'mobile/lib/big.js', linesOf(700));

  const result = scan(root, { 'mobile/lib/big.js': 700 });
  assert.equal(result.ok, true);
  assert.equal(result.legacy.length, 1);
});

test('removing the final baseline entry after the file is fixed leaves the tree clean', () => {
  const root = fixture();
  // The file that used to be the last baseline entry has been shrunk under the
  // limit, and its entry has been deleted from BASELINE (an empty object here
  // stands in for "no more legacy debt").
  put(root, 'mobile/lib/fixedAtLast.js', linesOf(LIMIT));

  const result = scan(root, {});
  assert.equal(result.ok, true);
  assert.equal(result.legacy.length, 0);
  assert.equal(result.regressions.length, 0);
});

test('a baselined file reduced to exactly the limit fails as stale: its baseline entry must be removed', () => {
  const root = fixture();
  put(root, 'mobile/lib/graduated.js', linesOf(LIMIT));

  const result = scan(root, { 'mobile/lib/graduated.js': 700 });
  assert.equal(result.ok, false);
  assert.equal(result.regressions.length, 1);
  assert.deepEqual(
    result.regressions[0],
    { kind: 'stale', path: 'mobile/lib/graduated.js', count: LIMIT, baselineCount: 700 },
  );
  assert.equal(result.legacy.length, 0);
});

test('a baselined file reduced below the limit fails as stale: its baseline entry must be removed', () => {
  const root = fixture();
  put(root, 'mobile/lib/graduated.js', linesOf(LIMIT - 1));

  const result = scan(root, { 'mobile/lib/graduated.js': 700 });
  assert.equal(result.ok, false);
  assert.equal(result.regressions.length, 1);
  assert.equal(result.regressions[0].kind, 'stale');
  assert.equal(result.regressions[0].count, LIMIT - 1);
});

test('removing the baseline entry after graduation yields a clean result: later growth past 600 would fail as new', () => {
  const root = fixture();
  // Simulate the state after a card removes the BASELINE entry following reduction.
  // Now the file is at the limit with no baseline entry — clean.
  put(root, 'mobile/lib/graduated.js', linesOf(LIMIT));

  const result = scan(root, {});
  assert.equal(result.ok, true);
  assert.equal(result.regressions.length, 0);

  // Now simulate a later PR that grows the file past 600 — must fail as new violation.
  const root2 = fixture();
  put(root2, 'mobile/lib/graduated.js', linesOf(LIMIT + 1));
  const result2 = scan(root2, {});
  assert.equal(result2.ok, false);
  assert.equal(result2.regressions[0].kind, 'new');
});

test('a baseline entry with no matching file (deleted or renamed) fails as orphaned', () => {
  const root = fixture();
  // No file written — baseline entry for a path that does not exist.
  const result = scan(root, { 'mobile/lib/deleted.js': 700 });
  assert.equal(result.ok, false);
  assert.equal(result.regressions.length, 1);
  assert.deepEqual(
    result.regressions[0],
    { kind: 'orphaned', path: 'mobile/lib/deleted.js', baselineCount: 700 },
  );
});

test('removing the orphaned baseline entry after deletion yields a clean result', () => {
  const root = fixture();
  // File is gone and baseline entry has been removed — tree is clean.
  const result = scan(root, {});
  assert.equal(result.ok, true);
  assert.equal(result.regressions.length, 0);
});

test('an orphaned entry does not let a recreated over-limit file pass once the entry is removed', () => {
  const root = fixture();
  // Simulate a later PR that recreates the file over the limit with no baseline entry.
  put(root, 'mobile/lib/deleted.js', linesOf(LIMIT + 1));
  const result = scan(root, {});
  assert.equal(result.ok, false);
  assert.equal(result.regressions[0].kind, 'new');
});

test('removing a baseline entry without fixing the file fails it as a new violation', () => {
  const root = fixture();
  put(root, 'mobile/lib/stillBig.js', linesOf(650));

  // Baseline entry deleted, but the file was never actually shrunk: the
  // deletion is treated as no different from a fresh over-limit file.
  const result = scan(root, {});
  assert.equal(result.ok, false);
  assert.equal(result.regressions[0].kind, 'new');
});

test('scope excludes anything outside mobile/', () => {
  assert.equal(isProductionFile('scripts/check-app-file-lines.mjs'), false);
  assert.equal(isProductionFile('package.json'), false);
});

test('scope excludes test files by suffix, regardless of directory', () => {
  assert.equal(isProductionFile('mobile/components/Foo.test.js'), false);
  assert.equal(isProductionFile('mobile/components/Foo.spec.tsx'), false);
  assert.equal(isProductionFile('mobile/components/Foo.js'), true);
});

test('scope excludes tests/, fixtures/, and mock directories at any depth', () => {
  assert.equal(isProductionFile('mobile/tests/helper.js'), false);
  assert.equal(isProductionFile('mobile/tests/mocks/thing.js'), false);
  assert.equal(isProductionFile('mobile/screens/__tests__/Foo.js'), false);
  assert.equal(isProductionFile('mobile/lib/__mocks__/thing.js'), false);
  assert.equal(isProductionFile('mobile/lib/fixtures/data.js'), false);
});

test('scope excludes configuration entry points but not files that merely mention "config"', () => {
  assert.equal(isProductionFile('mobile/metro.config.js'), false);
  assert.equal(isProductionFile('mobile/app.config.js'), false);
  assert.equal(isProductionFile('mobile/babel.config.js'), false);
  // A real production module whose name happens to contain "Config" is not a
  // build-tool config file and must stay in scope.
  assert.equal(isProductionFile('mobile/lib/captchaConfig.js'), true);
});

test('scope excludes generated/vendor directories, including node_modules', () => {
  assert.equal(isProductionFile('mobile/node_modules/some-pkg/index.js'), false);
  assert.equal(isProductionFile('mobile/.expo/types/router.d.ts'), false);
  assert.equal(isProductionFile('mobile/dist/bundle.js'), false);
  assert.equal(isProductionFile('mobile/assets/generated.js'), false);
});

test('scope accepts .jsx, .ts, and .tsx alongside .js', () => {
  assert.equal(isProductionFile('mobile/components/Foo.jsx'), true);
  assert.equal(isProductionFile('mobile/lib/foo.ts'), true);
  assert.equal(isProductionFile('mobile/components/Foo.tsx'), true);
  assert.equal(isProductionFile('mobile/components/Foo.json'), false);
});

test('findProductionFiles never descends into node_modules, even when it holds thousands of files', () => {
  const root = fixture();
  put(root, 'mobile/node_modules/dep/index.js', linesOf(10));
  put(root, 'mobile/App.js', linesOf(10));

  assert.deepEqual(findProductionFiles(root), ['mobile/App.js']);
});

test('excluded tests, fixtures, and config never surface as violations even when huge', () => {
  const root = fixture();
  put(root, 'mobile/tests/huge.test.js', linesOf(5000));
  put(root, 'mobile/tests/fixtures/huge.js', linesOf(5000));
  put(root, 'mobile/metro.config.js', linesOf(5000));
  put(root, 'mobile/ok.js', linesOf(10));

  const result = scan(root, {});
  assert.deepEqual(result.files, ['mobile/ok.js']);
  assert.equal(result.ok, true);
});

test('report names every violating path and its count, and labels legacy debt separately from regressions', () => {
  const root = fixture();
  put(root, 'mobile/lib/newOffender.js', linesOf(610));
  put(root, 'mobile/lib/oldOffender.js', linesOf(650));

  const result = scan(root, { 'mobile/lib/oldOffender.js': 700 });
  const text = report(result);

  assert.match(text, /NEW\s+610\s+mobile\/lib\/newOffender\.js/);
  assert.match(text, /650\s+mobile\/lib\/oldOffender\.js/);
  assert.match(text, /Legacy debt/);
  assert.doesNotMatch(text, /GROWTH/);
});

// validateBaseline tests

test('validateBaseline: a new entry not in the ref baseline fails as baseline-added', () => {
  const violations = validateBaseline(
    { 'mobile/App.js': 1200 },
    {},
  );
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0], { kind: 'baseline-added', path: 'mobile/App.js', count: 1200 });
});

test('validateBaseline: an increased entry fails as baseline-increased', () => {
  const violations = validateBaseline(
    { 'mobile/App.js': 1300 },
    { 'mobile/App.js': 1191 },
  );
  assert.equal(violations.length, 1);
  assert.deepEqual(
    violations[0],
    { kind: 'baseline-increased', path: 'mobile/App.js', count: 1300, refCount: 1191 },
  );
});

test('validateBaseline: a decreased entry passes', () => {
  const violations = validateBaseline(
    { 'mobile/App.js': 1000 },
    { 'mobile/App.js': 1191 },
  );
  assert.equal(violations.length, 0);
});

test('validateBaseline: an entry removed from the baseline passes', () => {
  const violations = validateBaseline(
    {},
    { 'mobile/App.js': 1191 },
  );
  assert.equal(violations.length, 0);
});

test('validateBaseline: an entry at the same count as the ref passes', () => {
  const violations = validateBaseline(
    { 'mobile/App.js': 1191 },
    { 'mobile/App.js': 1191 },
  );
  assert.equal(violations.length, 0);
});

test('validateBaseline: growing a file and raising its allowance in the same commit is caught', () => {
  // This is the exact attack the finding describes: a file grows and its
  // BASELINE entry is raised to match, causing scan() to pass. validateBaseline
  // rejects this by comparing against the target-branch baseline.
  const violations = validateBaseline(
    { 'mobile/App.js': 1400 },
    { 'mobile/App.js': 1191 },
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'baseline-increased');
});

test('report labels a stale baseline entry as STALE and instructs removal', () => {
  const root = fixture();
  put(root, 'mobile/lib/done.js', linesOf(LIMIT));

  const result = scan(root, { 'mobile/lib/done.js': 700 });
  const text = report(result);

  assert.equal(result.ok, false);
  assert.match(text, /STALE\s+600\s+mobile\/lib\/done\.js/);
  assert.match(text, /remove this entry from BASELINE/);
});

test('report reads as a clean pass when only legacy debt (no regressions) remains', () => {
  const root = fixture();
  put(root, 'mobile/lib/oldOffender.js', linesOf(650));

  const result = scan(root, { 'mobile/lib/oldOffender.js': 700 });
  const text = report(result);

  assert.equal(result.ok, true);
  assert.match(text, /No new violations\. No baseline growth\./);
  assert.match(text, /650\s+mobile\/lib\/oldOffender\.js/);
});
