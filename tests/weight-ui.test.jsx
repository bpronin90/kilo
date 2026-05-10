// MVP weight entry validation tests (UI path: log and edit)
// Run: node tests/weight-ui.test.jsx

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

// --- Log path: accepted inputs ---
console.log('\nparseWeightEntry — accepted (log and edit path)');

test('integer weight', () => {
  const r = window.parseWeightEntry('180');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.weight_value, 180);
  assert.strictEqual(r.weight_unit, 'lb');
});

test('decimal weight', () => {
  const r = window.parseWeightEntry('180.4');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.weight_value, 180.4);
});

test('trailing zero decimal', () => {
  const r = window.parseWeightEntry('167.0');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.weight_value, 167.0);
});

test('surrounding whitespace trimmed', () => {
  const r = window.parseWeightEntry(' 167.0 ');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.weight_value, 167.0);
});

test('logged_at is an ISO timestamp', () => {
  const r = window.parseWeightEntry('180');
  assert.strictEqual(r.ok, true);
  assert.ok(r.logged_at && !isNaN(Date.parse(r.logged_at)));
});

// --- Log and edit path: rejected inputs ---
console.log('\nparseWeightEntry — rejected (log and edit path)');

test('empty string rejected', () => {
  const r = window.parseWeightEntry('');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.category, 'missing_required_field');
});

test('null rejected', () => {
  const r = window.parseWeightEntry(null);
  assert.strictEqual(r.ok, false);
});

test('unit suffix rejected', () => {
  assert.strictEqual(window.parseWeightEntry('180 lb').ok, false);
  assert.strictEqual(window.parseWeightEntry('180lbs').ok, false);
});

test('comma decimal rejected', () => {
  assert.strictEqual(window.parseWeightEntry('180,4').ok, false);
});

test('inline note rejected', () => {
  assert.strictEqual(window.parseWeightEntry('180 / felt light').ok, false);
});

test('date prefix rejected', () => {
  assert.strictEqual(window.parseWeightEntry('2026-05-08 180.4').ok, false);
});

test('prose rejected', () => {
  assert.strictEqual(window.parseWeightEntry('one eighty').ok, false);
});

test('zero rejected', () => {
  const r = window.parseWeightEntry('0');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.category, 'invalid_field_value');
});

test('negative rejected', () => {
  assert.strictEqual(window.parseWeightEntry('-5').ok, false);
});

// --- Edit path: same rules apply ---
// The edit path in weight.jsx now calls parseWeightEntry instead of parseFloat,
// so these inputs must be rejected (previously parseFloat would silently coerce them).
console.log('\nparseWeightEntry — edit-path bypass cases now blocked');

test('edit: "180lbs" blocked', () => {
  assert.strictEqual(window.parseWeightEntry('180lbs').ok, false);
});

test('edit: "0" blocked', () => {
  assert.strictEqual(window.parseWeightEntry('0').ok, false);
});

test('edit: "-5" blocked', () => {
  assert.strictEqual(window.parseWeightEntry('-5').ok, false);
});

test('edit: whitespace-only blocked', () => {
  assert.strictEqual(window.parseWeightEntry('   ').ok, false);
});

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
