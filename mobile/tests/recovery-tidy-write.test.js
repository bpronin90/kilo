// Tidy names write path (#1309, amended): baseline step then weeks through the
// ordinary note compare-and-set path. No journal, payload or Undo: a partial run
// leaves lifts visibly unmatched and a re-run finishes them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { normalizeExerciseKey } from '../lib/parser';
import { planTidyNames } from '../lib/data/recoveryTidyNames';
import { deriveRecoveryStrength, LIFT_STATE } from '../lib/data/recoveryStrength';
import { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY, RECOVERY_OPERATION_JOURNAL_KEY, WORKOUT_NOTES_KEY } from '../storage/entries/keys';
import * as Storage from '../storage/entries';
import { __resetRecoveryOperationJournal } from '../storage/entries/recoveryOperationJournal';
import { compareAndSetWorkoutNoteText } from '../storage/entries/workoutNotes';
import { applyBaselineNameChanges, writeRecoveryBlockBaselineNames } from '../storage/entries/recoveryBaselineNameStorage';
import { tidyNamesCore } from '../hooks/entries/recoveryTidyMutations';

const STAMP = '2026-05-01T00:00:00Z';
const MESSY = 'Squat — 3×6-8, start light';
const HEADERS = ['Squat 3x6-8, step up from empty bar', 'Squat 3x6-8, step up', 'Squat 3x8'];
const read = async (key) => JSON.parse((await AsyncStorage.getItem(key)) || '[]');
const noteTexts = async () => (await read(WORKOUT_NOTES_KEY)).map(n => n.raw_text);

let original;
const saveNoteText = (id, a, b) => compareAndSetWorkoutNoteText(id, a, b);
const storage = (over = {}) => ({ ...Storage, writeBaselineNames: writeRecoveryBlockBaselineNames, saveNoteText, ...over });

async function seed({ messyBaseline = true } = {}) {
  const captured = captureRecoveryBaselineFromText('-Squat\n- 225 5,5,5\n-Bench\n- 185 5');
  const baseline = { ...captured, exercises: captured.exercises.map((r, i) => (i === 0 && messyBaseline ? { ...r, key: normalizeExerciseKey(MESSY), name: MESSY } : { ...r })) };
  const block = {
    id: 'rb1', baseline, baseline_note_id: 'nb', baseline_note_title: 'Routine', started_at: STAMP, completed_at: null,
    saved_at: STAMP, updated_at: STAMP, deleted_at: null, include_in_normal_analytics: false, reason: null,
  };
  await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([block]));
  await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(HEADERS.map((_h, i) => ({
    id: `w${i + 1}`, block_id: 'rb1', note_id: `n${i + 1}`, week_number: i + 1, completed_at: null, saved_at: STAMP, updated_at: STAMP, deleted_at: null,
  }))));
  await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(HEADERS.map((h, i) => ({
    id: `n${i + 1}`, title: `Week ${i + 1}`, raw_text: `-${h}\r\n- 135 8,8,8\r\n-Bench\r\n- ${100 + i} 5\r\n`,
    saved_at: STAMP, updated_at: STAMP, deleted_at: null, isCurrent: i === 0, tracked_exercises: ['x'],
  }))));
  original = await noteTexts();
}
async function review() {
  const block = (await Storage.loadRecoveryBlocks())[0];
  const plan = planTidyNames({ block, weeks: await Storage.loadRecoveryBlockWeeks(), notes: await Storage.loadWorkoutNotes() });
  return { blockId: 'rb1', evidence: plan.evidence, signature: plan.signature };
}
const tidy = async (over = {}, st = storage()) => tidyNamesCore(st, { ...(await review()), ...over });
const squatScores = async () => {
  const block = (await Storage.loadRecoveryBlocks())[0];
  const notes = await Storage.loadWorkoutNotes();
  return (await Storage.loadRecoveryBlockWeeks()).map(w => deriveRecoveryStrength({ block, weeks: [w], notes })
    .lifts.find(l => l.key === 'squat')?.state);
};

beforeEach(async () => { await AsyncStorage.clear(); __resetRecoveryOperationJournal(); await seed(); });

describe('baseline then weeks', () => {
  test('cleans the baseline name and every week; numbers, pair and metadata are untouched; all weeks score', async () => {
    const before = (await read(RECOVERY_BLOCKS_KEY))[0];
    expect((await squatScores()).filter(s => s === LIFT_STATE.SCORED)).toHaveLength(0);
    expect(await tidy()).toMatchObject({ ok: true, noteCount: 2, nameCount: 1 });
    const after = (await read(RECOVERY_BLOCKS_KEY))[0];
    expect(after.baseline.exercises[0]).toEqual({ ...before.baseline.exercises[0], key: 'squat', name: 'Squat' });
    expect(after.baseline.exercises.slice(1)).toEqual(before.baseline.exercises.slice(1));
    expect(after.baseline.version).toBe(before.baseline.version);
    expect(await noteTexts()).toEqual([
      '-Squat 3x6-8\r\n- 135 8,8,8\r\n-- step up from empty bar\r\n-Bench\r\n- 100 5\r\n',
      '-Squat 3x6-8\r\n- 135 8,8,8\r\n-- step up\r\n-Bench\r\n- 101 5\r\n',
      original[2],
    ]);
    expect((await read(WORKOUT_NOTES_KEY))[0]).toMatchObject({ isCurrent: true, tracked_exercises: ['x'], title: 'Week 1' });
    expect(await squatScores()).toEqual([LIFT_STATE.SCORED, LIFT_STATE.SCORED, LIFT_STATE.SCORED]);
    expect(await read(RECOVERY_OPERATION_JOURNAL_KEY)).toEqual([]);
  });

  test('is idempotent: a second run reports nothing to change and writes nothing', async () => {
    expect((await tidy()).ok).toBe(true);
    const frozen = JSON.stringify([await read(WORKOUT_NOTES_KEY), await read(RECOVERY_BLOCKS_KEY)]);
    expect(await tidy()).toMatchObject({ ok: false, error: expect.stringMatching(/already tidy/i) });
    expect(JSON.stringify([await read(WORKOUT_NOTES_KEY), await read(RECOVERY_BLOCKS_KEY)])).toBe(frozen);
  });
});

describe('stale preview', () => {
  test.each([
    ['note text', async () => { const n = await read(WORKOUT_NOTES_KEY); n[1].raw_text += '-- edited\r\n'; await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(n)); }],
    ['note timestamp', async () => { const n = await read(WORKOUT_NOTES_KEY); n[0].updated_at = 'later'; await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(n)); }],
    ['membership', async () => { const w = await read(RECOVERY_BLOCK_WEEKS_KEY); w[2].deleted_at = STAMP; await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(w)); }],
    ['baseline', async () => { const [b] = await read(RECOVERY_BLOCKS_KEY); b.baseline.exercises[1].name = 'Bench Press'; await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([b])); }],
    ['lifecycle', async () => { const [b] = await read(RECOVERY_BLOCKS_KEY); b.completed_at = STAMP; await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([b])); }],
    ['deleted block', async () => { const [b] = await read(RECOVERY_BLOCKS_KEY); b.deleted_at = STAMP; await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify([b])); }],
  ])('a changed %s rejects with zero writes', async (_n, mutate) => {
    const params = await review();
    await mutate();
    const frozen = JSON.stringify([await read(WORKOUT_NOTES_KEY), await read(RECOVERY_BLOCKS_KEY), await read(RECOVERY_BLOCK_WEEKS_KEY)]);
    expect(await tidyNamesCore(storage(), params)).toMatchObject({ ok: false });
    expect(JSON.stringify([await read(WORKOUT_NOTES_KEY), await read(RECOVERY_BLOCKS_KEY), await read(RECOVERY_BLOCK_WEEKS_KEY)])).toBe(frozen);
  });

  test('a missing fingerprint is rejected', async () => {
    expect(await tidy({ evidence: undefined })).toMatchObject({ ok: false });
    expect(await noteTexts()).toEqual(original);
  });
});

describe('partial failure is visible and re-runnable', () => {
  test('a failing note leaves that lift unmatched; a re-run finishes only what is left', async () => {
    let calls = 0;
    const flaky = storage({ saveNoteText: async (...a) => { calls += 1; if (calls === 2) throw new Error('write failed'); return saveNoteText(...a); } });
    const result = await tidy({}, flaky);
    expect(result).toMatchObject({ ok: false, partial: true, error: expect.stringMatching(/Run Tidy names again/) });
    expect((await noteTexts())[0]).toContain('-- step up from empty bar');
    expect((await noteTexts())[1]).toBe(original[1]);
    expect((await read(RECOVERY_BLOCKS_KEY))[0].baseline.exercises[0].name).toBe('Squat'); // baseline step already done
    expect((await tidy()).ok).toBe(true);
    expect((await noteTexts())[1]).toContain('-- step up');
    expect((await noteTexts())[0].match(/^-- /gm)).toHaveLength(1);
  });

  test('a note edited after planning is not overwritten (ordinary compare-and-set)', async () => {
    const st = storage({ saveNoteText: async (id, a, b) => {
      if (id === 'n2') { const n = await read(WORKOUT_NOTES_KEY); n[1].raw_text += '- 145 6\r\n'; await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(n)); }
      return saveNoteText(id, a, b);
    } });
    const result = await tidy({}, st);
    expect(result).toMatchObject({ ok: false, partial: true });
    expect((await noteTexts())[1]).toContain('- 145 6');
  });
});

describe('baseline writer', () => {
  test('rejects a stale or colliding rename without writing; already-applied is a no-op', async () => {
    const [b] = await read(RECOVERY_BLOCKS_KEY);
    const change = { from_key: normalizeExerciseKey(MESSY), from_name: MESSY, to_key: 'squat', to_name: 'Squat' };
    expect(applyBaselineNameChanges(b.baseline, [{ ...change, from_name: 'other' }])).toBeNull();
    const clash = { ...b.baseline, exercises: [...b.baseline.exercises, { ...b.baseline.exercises[1], key: 'squat', name: 'Squat' }] };
    expect(applyBaselineNameChanges(clash, [change])).toBeNull();
    const done = applyBaselineNameChanges(b.baseline, [change]);
    expect(applyBaselineNameChanges(done, [change])).toBe(done);
    await expect(writeRecoveryBlockBaselineNames('rb1', [{ ...change, from_name: 'other' }])).rejects.toBeDefined();
    expect((await read(RECOVERY_BLOCKS_KEY))[0].baseline.exercises[0].name).toBe(MESSY);
  });
});

describe('persistence and backup round trip', () => {
  test('tidied notes and baseline export with clean names and the moved comment', async () => {
    const { exportBackup } = require('../storage/entries/backupExport');
    expect((await tidy()).ok).toBe(true);
    const out = await exportBackup();
    expect(out.workout_notes[1].raw_text).toContain('-- step up');
    expect(out.recovery_blocks[0].baseline.exercises[0]).toMatchObject({ key: 'squat', name: 'Squat', best_e1rm_weight: 225 });
  });
});
