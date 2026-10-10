// Write path for #1298: confirmed name match of one frozen v2 baseline row.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RECOVERY_ERROR_CODES, captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { deriveRecoveryComparison } from '../lib/data/recoveryAnalytics';
import { normalizeExerciseKey } from '../lib/parser';
import {
  loadRecoveryBlockWeeks,
  loadRecoveryBlocks,
  loadRecoveryBlocksRaw,
  replaceRecoveryBlockBaseline,
  replaceRecoveryBlocksRaw,
  renameRecoveryBlockBaselineRow,
} from '../storage/entries/recoveryStorage';
import { RECOVERY_BLOCK_WEEKS_KEY } from '../storage/entries/keys';
import { baselineNamesEvidence } from '../lib/data/recoveryBaselineNames';
import { matchBaselineNameCore as rawCore } from '../hooks/entries/recoveryBaselineMutations';
import { matchBaselineNameCore as barrelCore, useRecoveryBaselineNames } from '../hooks/entries/recoveryBlockHooks';

const STAMP = '2026-05-01T00:00:00Z';
function baselineWithNames(names) {
  const snap = captureRecoveryBaselineFromText(names.map((_n, i) => `-zz${i}\n- 8,8,8`).join('\n'));
  return { ...snap, exercises: snap.exercises.map((r, i) => ({ ...r, key: normalizeExerciseKey(names[i]), name: names[i] })) };
}
const mkNote = (id, logged) => ({ id, title: id, deleted_at: null, raw_text: logged.map(n => `-${n}\n- 8,8,8`).join('\n') });
const mkBlock = (names, over = {}) => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'Routine', baseline: baselineWithNames(names),
  started_at: STAMP, completed_at: null, saved_at: STAMP, updated_at: STAMP, deleted_at: null,
  include_in_normal_analytics: false, reason: 'knee', ...over,
});
const mkWeek = (n, noteId) => ({ id: `w${n}`, block_id: 'rb1', note_id: noteId, week_number: n, completed_at: null, saved_at: STAMP, updated_at: STAMP, deleted_at: null });
// Evidence is what the review fingerprinted; tests derive it from authoritative storage.
async function withEvidence(st, params) {
  const block = (await loadRecoveryBlocks()).find(b => b.id === params.blockId);
  const evidence = baselineNamesEvidence({ block, weeks: await loadRecoveryBlockWeeks(), notes });
  return rawCore(st, { evidence, ...params });
}
const matchBaselineNameCore = (st, params) => (params.evidence === undefined ? withEvidence(st, params) : rawCore(st, params));
const PARAMS = { blockId: 'rb1', fromKey: 'plank 3x45 sec', toKey: 'plank', toName: 'Plank' };

let notes;
const storage = (over = {}) => ({
  loadRecoveryBlocks, loadRecoveryBlockWeeks, loadWorkoutNotes: async () => notes,
  renameRecoveryBlockBaselineRow, ...over,
});
async function seed(block = mkBlock(['Plank 3x45 sec', 'Squat'])) {
  await replaceRecoveryBlocksRaw([block]);
  await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([mkWeek(1, 'n1')]));
  notes = [mkNote('n1', ['Plank', 'Squat'])];
}

beforeEach(async () => { await AsyncStorage.clear(); });

describe('renameRecoveryBlockBaselineRow', () => {
  test('changes only the row key/name and updated_at; everything else is preserved', async () => {
    const original = mkBlock(['Plank 3x45 sec', 'Squat'], { completed_at: '2026-06-01T00:00:00Z' });
    await replaceRecoveryBlocksRaw([original]);
    const updated = await renameRecoveryBlockBaselineRow('rb1', { fromKey: 'plank 3x45 sec', toKey: 'plank', toName: 'Plank' });
    expect(updated.updated_at).not.toBe(STAMP);
    const [stored] = await loadRecoveryBlocksRaw();
    expect(stored).toEqual(updated);
    expect({ ...stored, baseline: null, updated_at: null }).toEqual({ ...original, baseline: null, updated_at: null });
    const [row0, row1] = stored.baseline.exercises;
    expect({ ...row0, key: null, name: null }).toEqual({ ...original.baseline.exercises[0], key: null, name: null });
    expect([row0.key, row0.name]).toEqual(['plank', 'Plank']);
    expect(row1).toEqual(original.baseline.exercises[1]);
    expect(stored.baseline.version).toBe(original.baseline.version);
  });

  test('rejects v1, deleted, unknown, missing source, and collision without writing', async () => {
    const v1 = { version: 1, exercises: [{ key: 'plank 3x45 sec', name: 'x', exercise_class: 'reps_only' }] };
    await replaceRecoveryBlocksRaw([
      mkBlock(['Plank 3x45 sec'], { id: 'v1', baseline: v1 }),
      mkBlock(['Plank 3x45 sec'], { id: 'gone', deleted_at: STAMP }),
      mkBlock(['Plank 3x45 sec', 'Plank'], { id: 'col' }),
    ]);
    const before = JSON.stringify(await loadRecoveryBlocksRaw());
    const change = { fromKey: 'plank 3x45 sec', toKey: 'plank', toName: 'Plank' };
    await expect(renameRecoveryBlockBaselineRow('v1', change)).rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BASELINE_NOT_REBUILDABLE });
    await expect(renameRecoveryBlockBaselineRow('gone', change)).rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND });
    await expect(renameRecoveryBlockBaselineRow('zz', change)).rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND });
    await expect(renameRecoveryBlockBaselineRow('col', change)).rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BASELINE_NOT_REBUILDABLE });
    await expect(renameRecoveryBlockBaselineRow('rb1', { ...change, fromKey: 'nope' })).rejects.toBeDefined();
    expect(JSON.stringify(await loadRecoveryBlocksRaw())).toBe(before);
  });

  test('v1 rebuild and the generic patch restriction still hold', async () => {
    const v1 = { version: 1, exercises: [{ key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, volume: 300, sets_completed: 3 }] };
    await replaceRecoveryBlocksRaw([mkBlock([], { baseline: v1 })]);
    const v2 = captureRecoveryBaselineFromText('-Squat\n- 225 5,5,5');
    const rebuilt = await replaceRecoveryBlockBaseline('rb1', v2);
    expect(rebuilt.baseline).toEqual(v2);
    await expect(replaceRecoveryBlockBaseline('rb1', v2)).rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BASELINE_NOT_REBUILDABLE });
  });
});

describe('matchBaselineNameCore', () => {
  test('exposed through the hooks barrel', () => {
    expect(barrelCore).toBe(rawCore);
    expect(typeof useRecoveryBaselineNames).toBe('function');
  });

  test('confirms, flips the comparison, persists across reload, and leaves notes alone', async () => {
    await seed();
    const notesBefore = JSON.stringify(notes);
    const result = await matchBaselineNameCore(storage(), PARAMS);
    expect(result.ok).toBe(true);
    const [reloaded] = await loadRecoveryBlocks();
    expect(reloaded.baseline.exercises.map(r => r.key)).toEqual(['plank', 'squat']);
    const week = deriveRecoveryComparison({ block: reloaded, weeks: await loadRecoveryBlockWeeks(), notes }).weeks[0];
    expect(week.exercises.every(r => r.state !== 'not_reintroduced')).toBe(true);
    expect(week.added).toHaveLength(0);
    expect(JSON.stringify(notes)).toBe(notesBefore);
  });

  test('repeat application is an idempotent no-op that writes nothing', async () => {
    await seed();
    await matchBaselineNameCore(storage(), PARAMS);
    const after = JSON.stringify(await loadRecoveryBlocksRaw());
    const rename = jest.fn();
    const again = await matchBaselineNameCore(storage({ renameRecoveryBlockBaselineRow: rename }), PARAMS);
    expect(again).toMatchObject({ ok: true, noop: true });
    expect(rename).not.toHaveBeenCalled();
    expect(JSON.stringify(await loadRecoveryBlocksRaw())).toBe(after);
  });

  test.each([
    ['evidence changed (logged name no longer present)', async () => { notes = [mkNote('n1', ['Curl', 'Squat'])]; }],
    ['wrong target name', async () => { PARAMS_OVERRIDE.toName = 'Plank!'; }],
    ['no linked weeks', async () => { await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, '[]'); }],
  ])('stale: %s writes nothing', async (_n, mutate) => {
    PARAMS_OVERRIDE = {};
    await seed();
    await mutate();
    const before = JSON.stringify(await loadRecoveryBlocksRaw());
    const result = await matchBaselineNameCore(storage(), { ...PARAMS, ...PARAMS_OVERRIDE });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(await loadRecoveryBlocksRaw())).toBe(before);
  });

  test('choice group: only the picked row is renamed, the other row stays; unpicked or stale pair rejects', async () => {
    await seed(mkBlock(['Core: plank', 'Plank 3x45 sec', 'Squat']));
    const pick = { blockId: 'rb1', fromKey: 'core: plank', toKey: 'plank', toName: 'Plank' };
    expect((await matchBaselineNameCore(storage(), { ...pick, fromKey: 'squat' })).ok).toBe(false);
    expect((await matchBaselineNameCore(storage(), pick)).ok).toBe(true);
    const [b] = await loadRecoveryBlocks();
    expect(b.baseline.exercises.map(r => r.key)).toEqual(['plank', 'plank 3x45 sec', 'squat']);
    expect(b.baseline.exercises[1].name).toBe('Plank 3x45 sec');
    // Group resolved: the other row is no longer offered.
    expect((await matchBaselineNameCore(storage(), PARAMS)).ok).toBe(false);
  });

  test('stale baseline (metrics changed after the preview) is rejected without writing', async () => {
    await seed();
    const [block] = await loadRecoveryBlocks();
    const evidence = baselineNamesEvidence({ block, weeks: await loadRecoveryBlockWeeks(), notes });
    const changed = { ...block, baseline: { ...block.baseline, exercises: block.baseline.exercises.map(r => (r.key === 'plank 3x45 sec' ? { ...r, total_reps: 999 } : r)) } };
    await replaceRecoveryBlocksRaw([changed]);
    const before = JSON.stringify(await loadRecoveryBlocksRaw());
    const result = await rawCore(storage(), { ...PARAMS, evidence });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/Review them again/);
    expect(JSON.stringify(await loadRecoveryBlocksRaw())).toBe(before);
  });

  test('changed linked note (same candidate) and missing evidence are rejected without writing', async () => {
    await seed();
    const [block] = await loadRecoveryBlocks();
    const evidence = baselineNamesEvidence({ block, weeks: await loadRecoveryBlockWeeks(), notes });
    notes = [{ ...notes[0], raw_text: `${notes[0].raw_text}\n-Row\n- 5,5,5`, updated_at: '2026-07-01T00:00:00Z' }];
    const before = JSON.stringify(await loadRecoveryBlocksRaw());
    expect((await rawCore(storage(), { ...PARAMS, evidence })).ok).toBe(false);
    expect((await rawCore(storage(), PARAMS)).ok).toBe(false);
    expect(JSON.stringify(await loadRecoveryBlocksRaw())).toBe(before);
  });

  test('target-key collision, deleted block, unknown block, and v1 fail safely', async () => {
    await seed(mkBlock(['Plank 3x45 sec', 'Plank']));
    expect((await matchBaselineNameCore(storage(), PARAMS)).ok).toBe(false);
    await seed(mkBlock(['Plank 3x45 sec'], { deleted_at: STAMP }));
    expect((await matchBaselineNameCore(storage(), PARAMS)).ok).toBe(false);
    expect((await matchBaselineNameCore(storage(), { ...PARAMS, blockId: 'zz' })).ok).toBe(false);
    await seed(mkBlock([], { baseline: { version: 1, exercises: [] } }));
    expect((await matchBaselineNameCore(storage(), PARAMS)).ok).toBe(false);
  });

  test('a failed write reports failure and persists nothing', async () => {
    await seed();
    const before = JSON.stringify(await loadRecoveryBlocksRaw());
    const result = await matchBaselineNameCore(storage({
      renameRecoveryBlockBaselineRow: async () => { throw new Error('disk full'); },
    }), PARAMS);
    expect(result).toMatchObject({ ok: false, error: 'disk full' });
    expect(JSON.stringify(await loadRecoveryBlocksRaw())).toBe(before);
  });
});

let PARAMS_OVERRIDE = {};
