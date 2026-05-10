// MVP acceptance gate tests for parser.jsx
// Run: node tests/parser.test.jsx

const fs = require('fs');
const assert = require('assert');
const path = require('path');

const window = { KILO_TODAY: new Date().toISOString().slice(0, 10) };
global.window = window;
eval(fs.readFileSync(path.join(__dirname, '../parser.jsx'), 'utf8'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// --- parseWorkoutRow: accepted inputs ---
console.log('\nparseWorkoutRow — accepted');

test('skip marker', () => {
  const r = window.parseWorkoutRow('-');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.skipped, true);
});

test('rep-group with comma', () => {
  const r = window.parseWorkoutRow('8,8,8');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sets.length, 3);
  assert.ok(r.sets.every(s => s.weight_value === null));
  assert.deepStrictEqual(r.sets.map(s => s.rep_count), [8, 8, 8]);
});

test('load + rep-group', () => {
  const r = window.parseWorkoutRow('80 8,8,8');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sets.length, 3);
  assert.ok(r.sets.every(s => s.weight_value === 80));
});

test('two load+rep pairs (drop set)', () => {
  const r = window.parseWorkoutRow('85 8 80 8,8');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sets.length, 3);
  assert.strictEqual(r.sets[0].weight_value, 85);
  assert.strictEqual(r.sets[0].rep_count, 8);
  assert.strictEqual(r.sets[1].weight_value, 80);
  assert.strictEqual(r.sets[2].weight_value, 80);
});

test('decimal load', () => {
  const r = window.parseWorkoutRow('17.5 12,12');
  assert.strictEqual(r.ok, true);
  assert.ok(r.sets.every(s => s.weight_value === 17.5));
});

test('extra whitespace collapsed', () => {
  const r = window.parseWorkoutRow(' 90   8,8,7   85  8 ');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sets.length, 4);
  assert.strictEqual(r.sets[0].weight_value, 90);
  assert.strictEqual(r.sets[3].weight_value, 85);
  assert.strictEqual(r.sets[3].rep_count, 8);
});

test('blank row is ok', () => {
  const r = window.parseWorkoutRow('');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.blank, true);
});

test('set_index increments across pairs', () => {
  const r = window.parseWorkoutRow('85 8 80 8,8');
  assert.deepStrictEqual(r.sets.map(s => s.set_index), [1, 2, 3]);
});

test('rep-only sets have null weight_unit', () => {
  const r = window.parseWorkoutRow('8,8,8');
  assert.ok(r.sets.every(s => s.weight_unit === null));
});

test('load+rep sets have lb weight_unit', () => {
  const r = window.parseWorkoutRow('80 8,8');
  assert.ok(r.sets.every(s => s.weight_unit === 'lb'));
});

// --- parseWorkoutRow: rejected inputs ---
console.log('\nparseWorkoutRow — rejected');

test('timed format rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('5 min').ok, false);
});

test('prose after load rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('7.1 for 5').ok, false);
});

test('legacy instruction text rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('1x12-15 each arm 12.5 lbs').ok, false);
});

test('x-notation rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('80 x 8 x 8 x 8').ok, false);
});

test('unit suffix on load rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('80lb 8,8').ok, false);
});

test('slash-separated reps rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('80 8/8/8').ok, false);
});

test('bare integer rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('80').ok, false);
});

test('trailing comma rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('8,').ok, false);
});

test('non-numeric load rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('? 12,12').ok, false);
});

test('alphanumeric load rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('as55 8,8,8').ok, false);
});

test('trailing prose after reps rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('80 8,8 note').ok, false);
});

test('bare word rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('book').ok, false);
});

test('zero rep count rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('80 0,8').ok, false);
});

test('zero load rejected', () => {
  assert.strictEqual(window.parseWorkoutRow('0 8,8').ok, false);
});

// --- parseWorkoutEntry ---
console.log('\nparseWorkoutEntry');

test('valid entry returns ok with items', () => {
  const r = window.parseWorkoutEntry([{ exerciseName: 'Squat', raw: '80 8,8,8' }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].exercise_name, 'Squat');
  assert.strictEqual(r.items[0].result_kind, 'sets');
  assert.strictEqual(r.items[0].sets.length, 3);
});

test('all blanks or skipped rejected', () => {
  const r = window.parseWorkoutEntry([
    { exerciseName: 'Squat', raw: '' },
    { exerciseName: 'Press', raw: '-' },
  ]);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.category, 'structural_violation');
});

test('invalid row surfaces rowErrors', () => {
  const r = window.parseWorkoutEntry([
    { exerciseName: 'Squat', raw: '80 8,8' },
    { exerciseName: 'Press', raw: '80lb 8,8' },
  ]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.rowErrors && r.rowErrors.length > 0);
  assert.strictEqual(r.rowErrors[0].exerciseName, 'Press');
});

test('position increments across items', () => {
  const r = window.parseWorkoutEntry([
    { exerciseName: 'Squat', raw: '80 8,8,8' },
    { exerciseName: 'Press', raw: '60 5,5' },
  ]);
  assert.strictEqual(r.items[0].position, 1);
  assert.strictEqual(r.items[1].position, 2);
});

test('workout_date defaults to today when omitted', () => {
  const r = window.parseWorkoutEntry([{ exerciseName: 'Squat', raw: '80 8,8,8' }]);
  assert.strictEqual(r.workout_date, window.KILO_TODAY);
});

test('explicit workout_date is used', () => {
  const r = window.parseWorkoutEntry([{ exerciseName: 'Squat', raw: '80 8,8,8' }], '2026-01-01');
  assert.strictEqual(r.workout_date, '2026-01-01');
});

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
