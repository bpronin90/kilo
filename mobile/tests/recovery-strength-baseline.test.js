// Frozen best-set strength pair (#1305): capture, legacy rebuild with name-match
// preservation, the storage rebuild gate, and backup validation of the pair.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRecoveryBaselineFromText, planBaselineRebuild } from '../lib/data/recoveryBlocks';
import {
  baselineLacksStrengthData, baselineStrengthPair, bestEpleySet, epley, preserveNameMatches, strengthPairError,
} from '../lib/data/recoveryStrengthBaseline';
import {
  loadRecoveryBlocks, loadRecoveryBlocksRaw, loadRecoveryBlockWeeks, loadRecoveryBlockWeeksRaw,
  replaceRecoveryBlockBaseline, replaceRecoveryBlocksRaw,
} from '../storage/entries/recoveryStorage';
import { validateRecoveryBlocks } from '../storage/entries/backupValidation';
import { __resetRecoveryOperationJournal } from '../storage/entries/recoveryOperationJournal';
import { rebuildRecoveryBaselineCore } from '../hooks/entries/recoveryBlockHooks';
import { kgMarkerToLb } from '../lib/units';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetRecoveryOperationJournal();
});
afterEach(() => __resetRecoveryOperationJournal());

const row = (snap, key) => snap.exercises.find(r => r.key === key);
// A frozen v2 snapshot as captured before #1305: same rows, no pair.
const legacyV2 = (snap) => ({ ...snap, exercises: snap.exercises.map(({ best_e1rm_weight, best_e1rm_reps, ...r }) => r) });

describe('capture', () => {
  test('the pair is the best Epley set, not the heaviest set', () => {
    const r = row(captureRecoveryBaselineFromText('-Squat\n- 200 10 225 3'), 'squat');
    expect(epley(200, 10)).toBeGreaterThan(epley(225, 3));
    expect(r).toMatchObject({ top_weight: 225, best_e1rm_weight: 200, best_e1rm_reps: 10 });
  });

  test('the pair comes from the exact session the v2 complete rule selects, and from the fallback session otherwise', () => {
    const complete = row(captureRecoveryBaselineFromText('-Deadlift: 3x6\n- 315 6,6,5\n- 325 6,6,6\n- 335 2,-,-'), 'deadlift');
    expect(complete).toMatchObject({ basis: 'complete', best_e1rm_weight: 325, best_e1rm_reps: 6 });
    const fallback = row(captureRecoveryBaselineFromText('-Row\n- 100 8\n- 110 5'), 'row');
    expect(fallback).toMatchObject({ basis: 'no_declaration', best_e1rm_weight: 110, best_e1rm_reps: 5 });
  });

  test('kg and lb logs freeze the same canonical-pound pair', () => {
    const kg = row(captureRecoveryBaselineFromText('-Bench\n- 100kg 5'), 'bench');
    expect(kg.best_e1rm_weight).toBe(kgMarkerToLb(100));
    expect(kg.best_e1rm_weight).toBe(kg.top_weight);
  });

  test('timed, reps-only and assisted-only rows carry no pair', () => {
    const snap = captureRecoveryBaselineFromText('-Plank: 3x45s\n- 45,45,45\n-Pull-up\n- 8,8,8\n-Dip\n- -20 8,8');
    for (const r of snap.exercises) {
      expect(r.best_e1rm_weight).toBeUndefined();
      expect(r.best_e1rm_reps).toBeUndefined();
    }
  });

  test('bestEpleySet skips skipped, assisted, zero and non-finite sets and keeps the first of equal sets', () => {
    expect(bestEpleySet([
      { weight_value: 300, rep_count: 5, skipped: true },
      { weight_value: 300, rep_count: 5, assistance_value: -20 },
      { weight_value: 0, rep_count: 5 },
      { weight_value: Infinity, rep_count: 5 },
    ])).toBeNull();
    const first = { weight_value: 100, rep_count: 5 };
    expect(bestEpleySet([first, { weight_value: 100, rep_count: 5 }])).toEqual({ weight: 100, reps: 5, e1rm: epley(100, 5) });
  });
});

describe('pair validation', () => {
  const w = { exercise_class: 'weighted' };
  test.each([
    ['absent', { ...w }, null],
    ['complete', { ...w, best_e1rm_weight: 100, best_e1rm_reps: 5 }, null],
    ['partial', { ...w, best_e1rm_weight: 100 }, /incomplete/],
    ['zero', { ...w, best_e1rm_weight: 0, best_e1rm_reps: 5 }, /positive finite/],
    ['non-finite', { ...w, best_e1rm_weight: 100, best_e1rm_reps: Infinity }, /positive finite/],
    ['string', { ...w, best_e1rm_weight: '100', best_e1rm_reps: 5 }, /positive finite/],
    ['on a timed row', { exercise_class: 'time_based', best_e1rm_weight: 100, best_e1rm_reps: 5 }, /only valid on weighted/],
  ])('%s pair', (_n, r, expected) => {
    if (expected === null) expect(strengthPairError(r)).toBeNull();
    else expect(strengthPairError(r)).toMatch(expected);
  });

  test('an invalid pair never yields a score', () => {
    expect(baselineStrengthPair({ ...w, best_e1rm_weight: 100 })).toBeNull();
    expect(baselineStrengthPair({ exercise_class: 'reps_only', best_e1rm_weight: 100, best_e1rm_reps: 5 })).toBeNull();
  });

  const backupBlock = (baseline) => [{
    id: 'rb1', baseline_note_id: 'n1', baseline_note_title: 'R', baseline,
    started_at: '2026-05-01T00:00:00Z', completed_at: null, saved_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z', deleted_at: null, include_in_normal_analytics: false,
  }];
  test('backup import accepts a complete pair and rejects a partial one', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n- 135 5');
    expect(validateRecoveryBlocks(backupBlock(snap)).ok).toBe(true);
    expect(validateRecoveryBlocks(backupBlock(legacyV2(snap))).ok).toBe(true);
    const partial = { ...snap, exercises: [{ ...snap.exercises[0], best_e1rm_reps: undefined }] };
    delete partial.exercises[0].best_e1rm_reps;
    const result = validateRecoveryBlocks(backupBlock(partial));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/best-set pair is incomplete/);
  });
});

describe('legacy rebuild (#1305)', () => {
  const ROUTINE = '-Squat 3x5\n- 225 5,5,5\n-Plank 3x45s\n- 45,45,45\n-Bench 3x5\n- 135 5,5,5';
  const CAPTURED = captureRecoveryBaselineFromText(ROUTINE);
  const note = (over = {}) => ({ id: 'n1', title: 'Routine', raw_text: ROUTINE, updated_at: '2026-04-01T00:00:00Z', deleted_at: null, ...over });
  const block = (baseline, over = {}) => ({
    id: 'rb1', baseline_note_id: 'n1', baseline_note_title: 'Routine', baseline,
    started_at: '2026-05-01T00:00:00Z', completed_at: null, saved_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z', deleted_at: null, include_in_normal_analytics: false, reason: null, ...over,
  });
  const storage = (notes) => ({
    loadRecoveryBlocks, loadRecoveryBlocksRaw, loadRecoveryBlockWeeks, loadRecoveryBlockWeeksRaw,
    loadWorkoutNotes: async () => notes, replaceRecoveryBlockBaseline,
  });

  test('lacking strength data: v1 and pair-less v2 yes; a captured v2 or a v2 with no weighted rows no', () => {
    expect(baselineLacksStrengthData({ version: 1, exercises: [] })).toBe(true);
    expect(baselineLacksStrengthData(legacyV2(CAPTURED))).toBe(true);
    expect(baselineLacksStrengthData(CAPTURED)).toBe(false);
    expect(baselineLacksStrengthData(captureRecoveryBaselineFromText('-Plank 3x45s\n- 45,45,45'))).toBe(false);
    expect(baselineLacksStrengthData({ version: 3, exercises: [] })).toBe(false);
    // A #1305 capture whose only pair-less weighted row is loaded-duration is upgraded.
    expect(baselineLacksStrengthData(captureRecoveryBaselineFromText('-Bench\n- 100 5\n-Carry: 2x30s\n- 50 30,30'))).toBe(false);
  });

  test('a rebuild that would still have no scoreable lift is not offered (no rebuild loop)', () => {
    const onlyCarry = '-Carry: 2x30s\n- 50 30,30';
    const legacy = { version: 1, exercises: [{ key: 'carry', name: 'Carry', exercise_class: 'weighted', top_weight: 50, volume: 3000, sets_completed: 2 }] };
    const plan = planBaselineRebuild(block(legacy), note({ raw_text: onlyCarry }));
    expect(plan.eligible).toBe(false);
    expect(plan.message).toMatch(/no lifts with load and reps/);
  });

  test('a pair-less v2 block plans the exact capture, carrying old values for the preview', () => {
    const plan = planBaselineRebuild(block(legacyV2(CAPTURED)), note());
    expect(plan.eligible).toBe(true);
    expect(plan.baseline).toEqual(CAPTURED);
    expect(plan.previous).toEqual(legacyV2(CAPTURED).exercises);
    expect(Object.isFrozen(plan.baseline)).toBe(true);
    expect(planBaselineRebuild(block(legacyV2(CAPTURED)), note({ updated_at: '2026-06-01T00:00:00Z' })).editedAfterStart).toBe(true);
  });

  test('a confirmed name match (same canonical name, #1298) is carried onto the rebuilt row, keeping its new pair', () => {
    // The routine writes "Bench Press — heavy"; the lifter matched it to the
    // logged "Bench Press". Both reduce to the canonical "bench press".
    const routine = ROUTINE.replace('-Bench 3x5', '-Bench Press — heavy 3x5');
    const captured = captureRecoveryBaselineFromText(routine);
    const matched = legacyV2(captured);
    const from = matched.exercises[2].key;
    matched.exercises = matched.exercises.map(r => (r.key === from ? { ...r, key: 'bench press', name: 'Bench Press' } : r));
    const plan = planBaselineRebuild(block(matched), note({ raw_text: routine }));
    expect(plan.eligible).toBe(true);
    expect(plan.baseline.exercises.map(r => r.key)).toEqual(['squat', 'plank', 'bench press']);
    expect(row(plan.baseline, 'bench press')).toMatchObject({ name: 'Bench Press', best_e1rm_weight: 135, best_e1rm_reps: 5 });
  });

  test('an in-place edit is never a match: Bench 100x5,5 -> Incline Bench 100x8,2 drops Bench and adds Incline under its own name (PR #1308 review)', () => {
    const before = captureRecoveryBaselineFromText('-Bench\n- 100 5,5');
    const plan = planBaselineRebuild(block(legacyV2(before)), note({ raw_text: '-Incline Bench\n- 100 8,2' }));
    expect(plan.eligible).toBe(true);
    // One row, under the incline lift's own identity; its best set is never
    // frozen under the Bench identity.
    expect(plan.baseline.exercises).toHaveLength(1);
    expect(plan.baseline.exercises[0].key).not.toBe('bench');
    expect(plan.baseline.exercises[0]).toMatchObject({ best_e1rm_weight: 100, best_e1rm_reps: 8 });
    expect(row(plan.baseline, 'bench')).toBeUndefined();
  });

  test('a lift removed from the routine is dropped (no canonical counterpart can be a surviving match)', () => {
    const plan = planBaselineRebuild(block(legacyV2(CAPTURED)), note({ raw_text: '-Squat 3x5\n- 225 5,5,5\n-Bench 3x5\n- 135 5,5,5' }));
    expect(plan.eligible).toBe(true);
    expect(plan.baseline.exercises.map(r => r.key)).toEqual(['squat', 'bench']);
    expect(plan.previous.map(r => r.key)).toContain('plank');
  });

  test('leftover rows pair one-to-one inside a canonical group that keeps another row (owner data shape)', () => {
    // Frozen: "Dead bugs" and "Dead bugs 3x10 each side"; the routine renamed the
    // first to "Core: Dead bugs 3x8 each side" and kept the second.
    const frozen = legacyV2(captureRecoveryBaselineFromText('-Squat\n- 225 5\n-Dead bugs\n- 10,10\n-Dead bugs 3x10 each side\n- 10,10,10'));
    const plan = planBaselineRebuild(block(frozen), note({ raw_text: '-Squat\n- 225 5\n-Core: Dead bugs 3x8 each side\n- 8,8,8\n-Dead bugs 3x10 each side\n- 10,10,10' }));
    expect(plan.eligible).toBe(true);
    expect(plan.baseline.exercises.map(r => r.key)).toEqual(['squat', 'dead bugs', 'dead bugs 3x10 each side']);
    expect(row(plan.baseline, 'dead bugs')).toMatchObject({ name: 'Dead bugs', total_reps: 24 });
  });

  describe('clean names: a frozen name never logged in a recovery week takes the routine\'s current name (owner decision)', () => {
    const messy = '-DB Bench Press — 3×6-8, start at 70 lbs\n- 100 8\n-Squat\n- 225 5';
    const clean = '-DB Bench Press 3x6-8\n- 100 8\n-Squat\n- 225 5';
    const frozen = legacyV2(captureRecoveryBaselineFromText(messy));
    const wk = (note_id) => [{ id: 'w1', block_id: 'rb1', note_id, week_number: 1, deleted_at: null }];

    test('never logged -> the routine\'s clean name, reported as a rename', () => {
      const weekNote = { id: 'wn1', raw_text: '-DB Bench Press\n- 80 8' };
      const plan = planBaselineRebuild(block(frozen), note({ raw_text: clean }), { weeks: wk('wn1'), notes: [weekNote] });
      expect(plan.eligible).toBe(true);
      expect(plan.baseline.exercises.map(r => r.key)).toEqual(['db bench press', 'squat']);
      expect(plan.renamed).toEqual([{ from_key: 'db bench press — 3×6-8, start at 70 lbs', from_name: 'DB Bench Press — 3×6-8, start at 70 lbs', to_key: 'db bench press', to_name: 'DB Bench Press' }]);
    });

    test('a logged (possibly matched) name is kept', () => {
      const weekNote = { id: 'wn1', raw_text: '-DB Bench Press — 3×6-8, start at 70 lbs\n- 80 8' };
      const plan = planBaselineRebuild(block(frozen), note({ raw_text: clean }), { weeks: wk('wn1'), notes: [weekNote] });
      expect(plan.baseline.exercises[0].key).toBe('db bench press — 3×6-8, start at 70 lbs');
      expect(plan.renamed).toEqual([]);
    });

    test('an unreadable or missing week means unknown: the frozen name is kept', () => {
      const plan = planBaselineRebuild(block(frozen), note({ raw_text: clean }), { weeks: wk('gone'), notes: [] });
      expect(plan.baseline.exercises[0].key).toBe('db bench press — 3×6-8, start at 70 lbs');
      expect(planBaselineRebuild(block(frozen), note({ raw_text: clean })).baseline.exercises[0].key).toBe('db bench press — 3×6-8, start at 70 lbs');
    });
  });

  test('two leftovers against one new row in a group is ambiguous and refuses', () => {
    const frozen = legacyV2(captureRecoveryBaselineFromText('-Row, heavy\n- 100 5\n-Row, light\n- 60 10'));
    const plan = planBaselineRebuild(block(frozen), note({ raw_text: '-Row\n- 90 5' }));
    expect(baselineLacksStrengthData(frozen)).toBe(true);
    expect(plan.eligible).toBe(false);
    expect(plan.message).toMatch(/Row, heavy.*can’t be carried over safely/);
  });

  test('a new same-canonical row makes a confirmed match ambiguous, so the rebuild refuses (PR #1308 review)', () => {
    // Captured "Bench Press — heavy" (100x5) then Squat; matched to "Bench Press".
    const original = '-Bench Press — heavy\n- 100 5\n-Squat\n- 225 5';
    const matched = legacyV2(captureRecoveryBaselineFromText(original));
    matched.exercises = matched.exercises.map((r, i) => (i === 0 ? { ...r, key: 'bench press', name: 'Bench Press' } : r));
    // The source now also has a NEW "Bench Press" row at 200x5.
    const grown = `${original}\n-Bench Press\n- 200 5`;
    const plan = planBaselineRebuild(block(matched), note({ raw_text: grown }));
    expect(plan.eligible).toBe(false);
    expect(plan.message).toMatch(/Bench Press.*can’t be carried over safely.*not rebuilt/);
  });

  test('an unmatched row stays put when an unrelated exercise is added', () => {
    const plan = planBaselineRebuild(block(legacyV2(CAPTURED)), note({ raw_text: `${ROUTINE}\n-Row 3x5\n- 95 5,5,5` }));
    expect(plan.eligible).toBe(true);
    expect(plan.baseline.exercises.map(r => r.key)).toEqual(['squat', 'plank', 'bench', 'row']);
  });

  test('confirm upgrades once; a repeat confirm and a stale preview write nothing', async () => {
    await replaceRecoveryBlocksRaw([block(legacyV2(CAPTURED))]);
    const ok = await rebuildRecoveryBaselineCore(storage([note()]), { blockId: 'rb1', expectedBaseline: CAPTURED });
    expect(ok.ok).toBe(true);
    expect((await loadRecoveryBlocksRaw())[0].baseline).toEqual(CAPTURED);
    const after = JSON.stringify(await loadRecoveryBlocksRaw());
    const again = await rebuildRecoveryBaselineCore(storage([note()]), { blockId: 'rb1', expectedBaseline: CAPTURED });
    expect(again.ok).toBe(false);
    expect(JSON.stringify(await loadRecoveryBlocksRaw())).toBe(after);
  });

  test('a source routine deleted or edited after the preview writes nothing', async () => {
    await replaceRecoveryBlocksRaw([block(legacyV2(CAPTURED))]);
    const before = JSON.stringify(await loadRecoveryBlocksRaw());
    expect((await rebuildRecoveryBaselineCore(storage([]), { blockId: 'rb1', expectedBaseline: CAPTURED })).ok).toBe(false);
    const edited = note({ raw_text: ROUTINE.replace('225', '245') });
    const stale = await rebuildRecoveryBaselineCore(storage([edited]), { blockId: 'rb1', expectedBaseline: CAPTURED });
    expect(stale.error).toMatch(/changed since this preview/);
    expect(JSON.stringify(await loadRecoveryBlocksRaw())).toBe(before);
  });

  test('after rebuild, editing or deleting the source routine does not change the frozen pair', async () => {
    await replaceRecoveryBlocksRaw([block(legacyV2(CAPTURED))]);
    await rebuildRecoveryBaselineCore(storage([note()]), { blockId: 'rb1', expectedBaseline: CAPTURED });
    const frozen = (await loadRecoveryBlocksRaw())[0].baseline;
    expect(planBaselineRebuild((await loadRecoveryBlocksRaw())[0], note({ raw_text: ROUTINE.replace('225', '245') })).eligible).toBe(false);
    expect((await loadRecoveryBlocksRaw())[0].baseline).toEqual(frozen);
  });

  test('the storage gate refuses an upgraded block and a replacement still lacking pairs', async () => {
    await replaceRecoveryBlocksRaw([block(CAPTURED, { id: 'done' }), block(legacyV2(CAPTURED), { id: 'legacy' })]);
    await expect(replaceRecoveryBlockBaseline('done', CAPTURED)).rejects.toMatchObject({ code: expect.any(String) });
    await expect(replaceRecoveryBlockBaseline('legacy', legacyV2(CAPTURED))).rejects.toMatchObject({ code: expect.any(String) });
    expect((await loadRecoveryBlocksRaw()).find(b => b.id === 'legacy').baseline).toEqual(legacyV2(CAPTURED));
  });
});
