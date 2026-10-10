import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { deriveRecoveryComparison } from '../lib/data/recoveryAnalytics';
import {
  canonicalMatchKey,
  planBaselineNameMatches,
  renameBaselineRow,
} from '../lib/data/recoveryBaselineNames';
import { normalizeExerciseKey } from '../lib/parser';

// Real v2 baseline whose rows carry the given display names (metrics come from the parser).
export function baselineWithNames(names) {
  const text = names.map((_n, i) => `-zz${i}\n- 8,8,8`).join('\n');
  const snap = captureRecoveryBaselineFromText(text);
  return { ...snap, exercises: snap.exercises.map((r, i) => ({ ...r, key: normalizeExerciseKey(names[i]), name: names[i] })) };
}
export const blockWith = (names, over = {}) => ({
  id: 'rb1', baseline: baselineWithNames(names), deleted_at: null, ...over,
});
export const noteOf = (id, logged) => ({
  id, title: id, deleted_at: null, raw_text: logged.map(n => `-${n}\n- 8,8,8`).join('\n'),
});
export const weekOf = (n, noteId, over = {}) => ({
  id: `w${n}`, block_id: 'rb1', note_id: noteId, week_number: n, completed_at: null, deleted_at: null, ...over,
});
const plan = (names, weeksLogged) => planBaselineNameMatches({
  block: blockWith(names),
  weeks: weeksLogged.map((_l, i) => weekOf(i + 1, `n${i + 1}`)),
  notes: weeksLogged.map((l, i) => noteOf(`n${i + 1}`, l)),
});
const pairs = (c) => c.map(x => [x.from_name, x.to_name]);

describe('canonicalMatchKey', () => {
  test.each([
    ['Plank 3x45 sec', 'plank'],
    ['Single-Leg RDL 2x8 each leg', 'single-leg rdl'],
    ['Core: Dead bugs 3x8 each side', 'dead bugs'],
    ['Core: plank', 'plank'],
    ['Core: Pallof Press 2x10 each side', 'pallof press'],
    ['Dead bugs 3x10 each side', 'dead bugs'],
    ['Plank 3×45 sec', 'plank'],
    ['Bench Press, paused', 'bench press'],
    ['Bench Press — paused', 'bench press'],
    ['Squat', 'squat'],
  ])('%s -> %s', (name, key) => { expect(canonicalMatchKey(name)).toBe(key); });

  test('preserves meaningful distinctions', () => {
    expect(canonicalMatchKey('Single-Leg RDL')).not.toBe(canonicalMatchKey('RDL'));
    expect(canonicalMatchKey('Side plank')).not.toBe(canonicalMatchKey('Plank'));
    expect(canonicalMatchKey('')).toBe('');
  });
});

describe('planBaselineNameMatches', () => {
  test.each([
    ['Plank 3x45 sec', 'Plank'],
    ['Single-Leg RDL 2x8 each leg', 'Single-Leg RDL'],
    ['Core: Dead bugs 3x8 each side', 'Dead bugs'],
    ['Core: plank', 'Plank'],
    ['Core: Pallof Press 2x10 each side', 'Pallof Press'],
    ['Dead bugs 3x10 each side', 'Dead bugs'],
    ['Plank 3×45 sec', 'Plank'],
    ['Bench Press, paused', 'Bench Press'],
    ['Bench Press — paused', 'Bench Press'],
  ])('owner/variant %s is a positive candidate on its own', (from, to) => {
    const c = plan([from, 'Squat'], [[to, 'Squat']]);
    expect(pairs(c)).toEqual([[from, to]]);
    expect(c[0]).toMatchObject({ from_key: normalizeExerciseKey(from), to_key: normalizeExerciseKey(to) });
  });

  test('the combined owner roster with duplicate canonical Plank / Dead bugs rows is excluded, never merged', () => {
    const roster = [
      'Plank 3x45 sec', 'Single-Leg RDL 2x8 each leg', 'Core: Dead bugs 3x8 each side',
      'Core: plank', 'Core: Pallof Press 2x10 each side', 'Dead bugs 3x10 each side',
    ];
    const c = plan(roster, [['Plank', 'Single-Leg RDL', 'Dead bugs', 'Pallof Press']]);
    expect(pairs(c).sort()).toEqual([
      ['Core: Pallof Press 2x10 each side', 'Pallof Press'],
      ['Single-Leg RDL 2x8 each leg', 'Single-Leg RDL'],
    ]);
  });

  test('repeated sightings across weeks collapse to one candidate', () => {
    const c = plan(['Plank 3x45 sec'], [['Plank'], ['Plank'], ['Plank']]);
    expect(c).toHaveLength(1);
  });

  test('one baseline row with two logged targets (one-to-many) is excluded', () => {
    expect(plan(['Plank 3x45 sec'], [['Plank, side']])).toHaveLength(1);
    expect(plan(['Plank 3x45 sec'], [['Plank', 'Plank, side']])).toEqual([]);
  });

  test('many baseline rows to one logged name (many-to-one) is excluded', () => {
    expect(plan(['Plank 3x45 sec', 'Plank 2x30 sec'], [['Plank']])).toEqual([]);
  });

  test('an already exact-matched row blocks a second row from the same canonical name', () => {
    expect(plan(['Plank', 'Plank 3x45 sec'], [['Plank']])).toEqual([]);
  });

  test('a row matched in some week is not unmatched', () => {
    expect(plan(['Plank 3x45 sec'], [['plank 3x45 sec'], ['Plank']])).toEqual([]);
  });

  test('unrelated names produce nothing', () => {
    expect(plan(['Plank 3x45 sec'], [['Curl']])).toEqual([]);
  });

  test('no weeks, v1, and missing baselines are safe', () => {
    expect(planBaselineNameMatches({ block: blockWith(['Plank 3x45 sec']), weeks: [], notes: [] })).toEqual([]);
    expect(planBaselineNameMatches({ block: { id: 'x', baseline: { version: 1, exercises: [] } } })).toEqual([]);
    expect(planBaselineNameMatches({})).toEqual([]);
  });

  test('is read-only', () => {
    const block = blockWith(['Plank 3x45 sec']);
    const before = JSON.stringify(block);
    planBaselineNameMatches({ block, weeks: [weekOf(1, 'n1')], notes: [noteOf('n1', ['Plank'])] });
    expect(JSON.stringify(block)).toBe(before);
  });
});

describe('renameBaselineRow', () => {
  const base = baselineWithNames(['Plank 3x45 sec', 'Squat']);
  const change = { fromKey: 'plank 3x45 sec', toKey: 'plank', toName: 'Plank' };

  test('changes only the one row key/name and keeps order and metrics', () => {
    const next = renameBaselineRow(base, change);
    expect(next.exercises.map(r => r.key)).toEqual(['plank', 'squat']);
    expect({ ...next.exercises[0], key: null, name: null }).toEqual({ ...base.exercises[0], key: null, name: null });
    expect(next.exercises[1]).toBe(base.exercises[1]);
    expect(base.exercises[0].key).toBe('plank 3x45 sec');
  });

  test.each([
    ['v1', { version: 1, exercises: base.exercises }, change],
    ['missing source', base, { ...change, fromKey: 'nope' }],
    ['target collision', base, { ...change, toKey: 'squat' }],
    ['same key', base, { ...change, toKey: change.fromKey }],
    ['no name', base, { ...change, toName: '' }],
    ['null baseline', null, change],
  ])('rejects %s', (_n, b, c) => { expect(renameBaselineRow(b, c)).toBeNull(); });

  test('comparison flips from not-reintroduced + added to compared after the rename', () => {
    const block = blockWith(['Plank 3x45 sec']);
    const args = { weeks: [weekOf(1, 'n1')], notes: [noteOf('n1', ['Plank'])] };
    const before = deriveRecoveryComparison({ block, ...args }).weeks[0];
    expect(before.exercises[0].state).toBe('not_reintroduced');
    expect(before.added).toHaveLength(1);
    const renamed = { ...block, baseline: renameBaselineRow(block.baseline, { fromKey: 'plank 3x45 sec', toKey: 'plank', toName: 'Plank' }) };
    const after = deriveRecoveryComparison({ block: renamed, ...args }).weeks[0];
    expect(after.exercises[0].state).not.toBe('not_reintroduced');
    expect(after.added).toHaveLength(0);
  });
});
