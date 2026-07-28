import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseWorkoutNote } from '../lib/parser';
import {
  RECOVERY_BASELINE_VERSION,
  RECOVERY_ERROR_CODES,
  RecoveryBlockError,
  captureRecoveryBaseline,
  captureRecoveryBaselineFromText,
  findActiveBlock,
  findLiveMembershipForNote,
  isBlockActive,
  isLiveRecord,
  nextWeekNumber,
  orderedLiveWeeks,
} from '../lib/data/recoveryBlocks';
import {
  RECOVERY_BLOCKS_KEY,
  RECOVERY_BLOCK_WEEKS_KEY,
} from '../storage/entries/keys';
import {
  addRecoveryWeek,
  completeRecoveryBlock,
  completeRecoveryWeek,
  createRecoveryBlock,
  deleteRecoveryBlock,
  deleteRecoveryWeek,
  getActiveRecoveryBlock,
  loadRecoveryBlockWeeks,
  loadRecoveryBlockWeeksRaw,
  loadRecoveryBlocks,
  loadRecoveryBlocksRaw,
  loadRecoveryWeeksForBlock,
  replaceRecoveryBlockWeeksRaw,
  replaceRecoveryBlocksRaw,
  updateRecoveryBlock,
  updateRecoveryWeek,
} from '../storage/entries/recoveryStorage';

beforeEach(async () => {
  await AsyncStorage.clear();
});

// Build synthetic sections for exercise classes the text parser cannot yet
// express (durations), mirroring the helper style in data.test.js.
function synthSection(name, sessions, { kind = 'general', heading = null } = {}) {
  return {
    heading,
    subheading: null,
    kind,
    exercises: [{
      name,
      rows: [],
      sets: [],
      unparsed_rows: [],
      session_entries: sessions.map(sets =>
        sets === 'skip' ? { skipped: true, raw: '-', sets: [] } : { skipped: false, raw: 'x', sets }
      ),
    }],
  };
}
function repSet(rep_count) { return { weight_value: null, rep_count, duration_seconds: null, assistance_value: null }; }
function durSet(duration_seconds) { return { weight_value: null, rep_count: null, duration_seconds, assistance_value: null }; }
function wSet(weight_value, rep_count) { return { weight_value, rep_count, duration_seconds: null, assistance_value: null }; }

function baselineFor(snapshot, key) {
  return snapshot.exercises.find(e => e.key === key);
}

// ── baseline capture ──────────────────────────────────────────────────────────

describe('captureRecoveryBaseline — versioning and empty input', () => {
  test('stamps the current snapshot version', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n- 135 5,5,5');
    expect(snap.version).toBe(RECOVERY_BASELINE_VERSION);
  });

  test('empty note yields an empty, versioned snapshot', () => {
    const snap = captureRecoveryBaselineFromText('');
    expect(snap).toEqual({ version: RECOVERY_BASELINE_VERSION, exercises: [] });
  });

  test('null/undefined sections yield an empty snapshot rather than throwing', () => {
    expect(captureRecoveryBaseline(null).exercises).toEqual([]);
    expect(captureRecoveryBaseline(undefined).exercises).toEqual([]);
  });

  test('note that fails to parse yields an empty snapshot, not a throw', () => {
    // Over MAX_RAW_TEXT_LENGTH → parser returns ok:false with no sections.
    const oversized = 'x'.repeat(200001);
    expect(captureRecoveryBaselineFromText(oversized).exercises).toEqual([]);
  });

  test('malformed rows produce no fabricated baseline work', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n- garbage nonsense\n- also bad');
    expect(snap.exercises).toEqual([]);
  });

  test('exercise header with no logged sets produces no baseline row', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n-Squat\n- 225 5');
    expect(baselineFor(snap, 'bench')).toBeUndefined();
    expect(baselineFor(snap, 'squat')).toBeDefined();
  });
});

describe('captureRecoveryBaseline — weighted metrics', () => {
  test('captures top working weight and completed volume from the latest session', () => {
    const snap = captureRecoveryBaselineFromText(
      '-Bench\n- 135 5,5,5\n- 185 3,3'
    );
    expect(baselineFor(snap, 'bench')).toEqual({
      key: 'bench',
      name: 'Bench',
      exercise_class: 'weighted',
      top_weight: 185,
      volume: 185 * 3 + 185 * 3,
      sets_completed: 2,
    });
  });

  test('mixed-weight session uses the heaviest set for top_weight and sums all volume', () => {
    const snap = captureRecoveryBaselineFromText('-Squat\n- 225 5,5 275 3');
    const row = baselineFor(snap, 'squat');
    expect(row.top_weight).toBe(275);
    expect(row.volume).toBe(225 * 5 + 225 * 5 + 275 * 3);
    expect(row.sets_completed).toBe(3);
  });

  test('within-row skipped sets contribute no volume', () => {
    // "80 4,-" → a completed set of 4 then a skipped set, both at 80.
    const snap = captureRecoveryBaselineFromText('-Bench\n- 80 4,-');
    const row = baselineFor(snap, 'bench');
    expect(row.volume).toBe(80 * 4);
    expect(row.sets_completed).toBe(1);
  });

  test('weighted rows retain only weighted metrics', () => {
    const row = baselineFor(captureRecoveryBaselineFromText('-Bench\n- 135 5'), 'bench');
    expect(Object.keys(row).sort()).toEqual(
      ['exercise_class', 'key', 'name', 'sets_completed', 'top_weight', 'volume']
    );
    expect(row.best_set_reps).toBeUndefined();
    expect(row.best_hold_seconds).toBeUndefined();
  });
});

describe('captureRecoveryBaseline — reps-only and timed metrics', () => {
  test('reps-only retains best set and total reps only', () => {
    const snap = captureRecoveryBaseline([synthSection('Pull-up', [[repSet(8), repSet(7), repSet(5)]])]);
    expect(baselineFor(snap, 'pull-up')).toEqual({
      key: 'pull-up',
      name: 'Pull-up',
      exercise_class: 'reps_only',
      best_set_reps: 8,
      total_reps: 20,
      sets_completed: 3,
    });
  });

  test('timed retains best and total hold seconds only', () => {
    const snap = captureRecoveryBaseline([synthSection('Plank', [[durSet(45), durSet(60), durSet(30)]])]);
    expect(baselineFor(snap, 'plank')).toEqual({
      key: 'plank',
      name: 'Plank',
      exercise_class: 'time_based',
      best_hold_seconds: 60,
      total_seconds: 135,
      sets_completed: 3,
    });
  });

  test('any added load reclassifies an otherwise bodyweight exercise as weighted', () => {
    const snap = captureRecoveryBaseline([synthSection('Pull-up', [[wSet(25, 5), repSet(8)]])]);
    const row = baselineFor(snap, 'pull-up');
    expect(row.exercise_class).toBe('weighted');
    // The unloaded set carries no comparable top-weight signal and is excluded.
    expect(row.top_weight).toBe(25);
    expect(row.volume).toBe(125);
  });

  test('zero-rep and empty sets produce no baseline row', () => {
    const snap = captureRecoveryBaseline([synthSection('Pull-up', [[repSet(0)], []])]);
    expect(snap.exercises).toEqual([]);
  });
});

describe('captureRecoveryBaseline — trailing skips', () => {
  test('trailing skip does not erase the last completed session', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n- 135 5,5\n- 185 3\n-');
    const row = baselineFor(snap, 'bench');
    expect(row.top_weight).toBe(185);
    expect(row.volume).toBe(185 * 3);
  });

  test('multiple stacked trailing skips still resolve to the last real session', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n- 135 5,5\n- 185 3\n-\n-\n-');
    expect(baselineFor(snap, 'bench').top_weight).toBe(185);
  });

  test('an exercise skipped for its entire history produces no baseline row', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n-\n-');
    expect(snap.exercises).toEqual([]);
  });

  test('trailing unparsed row is stepped over like a skip', () => {
    const withUnparsed = captureRecoveryBaseline([{
      heading: null, subheading: null, kind: 'general',
      exercises: [{
        name: 'Bench', rows: [], sets: [], unparsed_rows: [],
        session_entries: [
          { skipped: false, raw: 'x', sets: [wSet(185, 3)] },
          { skipped: false, raw: '???', sets: [], unparsed: true },
        ],
      }],
    }]);
    expect(baselineFor(withUnparsed, 'bench').top_weight).toBe(185);
  });
});

describe('captureRecoveryBaseline — warmups', () => {
  test('warmup sections are excluded entirely', () => {
    const snap = captureRecoveryBaselineFromText(
      'Monday\n+WARMUP\n-Bench\n- 45 10\n+LIFTING\n-Squat\n- 225 5'
    );
    expect(baselineFor(snap, 'bench')).toBeUndefined();
    expect(baselineFor(snap, 'squat')).toBeDefined();
  });

  test('an exercise appearing in both warmup and lifting uses only the lifting data', () => {
    const snap = captureRecoveryBaselineFromText(
      'Monday\n+WARMUP\n-Bench\n- 45 10\n+LIFTING\n-Bench\n- 185 3'
    );
    const row = baselineFor(snap, 'bench');
    expect(row.top_weight).toBe(185);
    expect(row.volume).toBe(185 * 3);
  });
});

describe('captureRecoveryBaseline — identity and A/B routines', () => {
  test('A/B routine merges the same lift across the week separator, newest wins', () => {
    const snap = captureRecoveryBaselineFromText(
      '-Bench\n- 135 5\n---\n-Bench\n- 155 5'
    );
    expect(snap.exercises.filter(e => e.key === 'bench')).toHaveLength(1);
    expect(baselineFor(snap, 'bench').top_weight).toBe(155);
  });

  test('repeated occurrences within one note resolve to the last logged session', () => {
    const snap = captureRecoveryBaselineFromText(
      'Monday\n-Bench\n- 135 5\nThursday\n-Bench\n- 175 3'
    );
    expect(baselineFor(snap, 'bench').top_weight).toBe(175);
  });

  test('later occurrence that is skipped falls back to the earlier logged one', () => {
    const snap = captureRecoveryBaselineFromText(
      'Monday\n-Bench\n- 135 5\nThursday\n-Bench\n-'
    );
    expect(baselineFor(snap, 'bench').top_weight).toBe(135);
  });

  test('parser aliases collapse to one canonical identity', () => {
    const snap = captureRecoveryBaselineFromText(
      '-Barbell Squat\n- 225 5\n---\n-Back Squat\n- 245 3'
    );
    const squats = snap.exercises.filter(e => e.key === 'squat');
    expect(squats).toHaveLength(1);
    expect(squats[0].top_weight).toBe(245);
    expect(squats[0].name).toBe('Squat');
  });

  test('exercises are ordered deterministically by normalized key', () => {
    const a = captureRecoveryBaselineFromText('-Squat\n- 225 5\n-Bench\n- 135 5');
    const b = captureRecoveryBaselineFromText('-Bench\n- 135 5\n-Squat\n- 225 5');
    expect(a.exercises.map(e => e.key)).toEqual(['bench', 'squat']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('captureRecoveryBaseline — immutability', () => {
  test('the returned snapshot is deeply frozen', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n- 135 5');
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.exercises)).toBe(true);
    expect(Object.isFrozen(snap.exercises[0])).toBe(true);
  });

  test('mutating a frozen snapshot does not change it', () => {
    const snap = captureRecoveryBaselineFromText('-Bench\n- 135 5');
    try { snap.exercises[0].top_weight = 999; } catch { /* strict mode throws */ }
    expect(snap.exercises[0].top_weight).toBe(135);
  });
});

// ── predicates ────────────────────────────────────────────────────────────────

describe('domain predicates', () => {
  const live = { id: 'a', deleted_at: null, completed_at: null };
  const completed = { id: 'b', deleted_at: null, completed_at: '2026-01-01T00:00:00.000Z' };
  const tombstoned = { id: 'c', deleted_at: '2026-01-01T00:00:00.000Z', completed_at: null };

  test('isLiveRecord excludes tombstones only', () => {
    expect(isLiveRecord(live)).toBe(true);
    expect(isLiveRecord(completed)).toBe(true);
    expect(isLiveRecord(tombstoned)).toBe(false);
    expect(isLiveRecord(null)).toBe(false);
  });

  test('isBlockActive requires live and not completed', () => {
    expect(isBlockActive(live)).toBe(true);
    expect(isBlockActive(completed)).toBe(false);
    expect(isBlockActive(tombstoned)).toBe(false);
  });

  test('findActiveBlock ignores completed and tombstoned blocks', () => {
    expect(findActiveBlock([completed, tombstoned, live])).toBe(live);
    expect(findActiveBlock([completed, tombstoned])).toBeNull();
    expect(findActiveBlock([])).toBeNull();
  });

  test('orderedLiveWeeks sorts by week number and excludes tombstones', () => {
    const weeks = [
      { id: 'w3', block_id: 'b1', week_number: 3, deleted_at: null },
      { id: 'w1', block_id: 'b1', week_number: 1, deleted_at: null },
      { id: 'w2', block_id: 'b1', week_number: 2, deleted_at: '2026-01-01T00:00:00.000Z' },
      { id: 'wx', block_id: 'b2', week_number: 1, deleted_at: null },
    ];
    expect(orderedLiveWeeks(weeks, 'b1').map(w => w.id)).toEqual(['w1', 'w3']);
  });

  test('nextWeekNumber starts at 1 and advances past the highest live week', () => {
    expect(nextWeekNumber([], 'b1')).toBe(1);
    expect(nextWeekNumber([
      { id: 'w1', block_id: 'b1', week_number: 1, deleted_at: null },
      { id: 'w2', block_id: 'b1', week_number: 2, deleted_at: null },
    ], 'b1')).toBe(3);
  });

  test('findLiveMembershipForNote ignores tombstoned memberships', () => {
    const weeks = [{ id: 'w1', block_id: 'b1', note_id: 'n1', deleted_at: '2026-01-01T00:00:00.000Z' }];
    expect(findLiveMembershipForNote(weeks, 'n1')).toBeNull();
    weeks.push({ id: 'w2', block_id: 'b2', note_id: 'n1', deleted_at: null });
    expect(findLiveMembershipForNote(weeks, 'n1').id).toBe('w2');
  });
});

// ── storage: blocks ───────────────────────────────────────────────────────────

const BASELINE_NOTE = { id: 'wn_1', title: 'Routine 1', raw_text: '-Bench\n- 135 5,5\n- 185 3' };

async function makeBlock(overrides = {}) {
  return createRecoveryBlock({
    baselineNoteId: BASELINE_NOTE.id,
    baselineNoteTitle: BASELINE_NOTE.title,
    baselineNoteText: BASELINE_NOTE.raw_text,
    ...overrides,
  });
}

describe('createRecoveryBlock', () => {
  test('freezes the baseline from the selected routine at creation', async () => {
    const block = await makeBlock();
    expect(block.baseline.version).toBe(RECOVERY_BASELINE_VERSION);
    expect(baselineFor(block.baseline, 'bench')).toMatchObject({
      exercise_class: 'weighted',
      top_weight: 185,
      volume: 555,
    });
  });

  test('records baseline note identity and defaults', async () => {
    const block = await makeBlock();
    expect(block.baseline_note_id).toBe('wn_1');
    expect(block.baseline_note_title).toBe('Routine 1');
    expect(block.include_in_normal_analytics).toBe(false);
    expect(block.completed_at).toBeNull();
    expect(block.deleted_at).toBeNull();
    expect(block.started_at).toBe(block.saved_at);
    expect(block.id).toMatch(/^rb_/);
  });

  test('normal-analytics inclusion can be opted into explicitly', async () => {
    const block = await makeBlock({ includeInNormalAnalytics: true });
    expect(block.include_in_normal_analytics).toBe(true);
  });

  test('rejects a block with no baseline note id', async () => {
    await expect(createRecoveryBlock({ baselineNoteText: '-Bench\n- 135 5' }))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.INVALID_BASELINE_NOTE });
  });

  test('rejects a second active block deterministically', async () => {
    await makeBlock();
    await expect(makeBlock()).rejects.toBeInstanceOf(RecoveryBlockError);
    await expect(makeBlock()).rejects.toMatchObject({
      code: RECOVERY_ERROR_CODES.ACTIVE_BLOCK_EXISTS,
    });
    expect(await loadRecoveryBlocks()).toHaveLength(1);
  });

  test('a completed block does not block a new one', async () => {
    const first = await makeBlock();
    await completeRecoveryBlock(first.id);
    const second = await makeBlock();
    expect(second.id).not.toBe(first.id);
    expect((await getActiveRecoveryBlock()).id).toBe(second.id);
  });

  test('a tombstoned block does not block a new one', async () => {
    const first = await makeBlock();
    await deleteRecoveryBlock(first.id);
    const second = await makeBlock();
    expect((await getActiveRecoveryBlock()).id).toBe(second.id);
  });
});

describe('baseline immutability after creation', () => {
  test('editing the source routine later does not change the frozen snapshot', async () => {
    const block = await makeBlock();
    const frozen = JSON.stringify(block.baseline);

    // The routine gets heavier after recovery starts; the block must not follow.
    const reread = (await loadRecoveryBlocks())[0];
    expect(JSON.stringify(reread.baseline)).toBe(frozen);

    const fresh = captureRecoveryBaselineFromText('-Bench\n- 315 5');
    expect(fresh.exercises[0].top_weight).toBe(315);
    expect((await loadRecoveryBlocks())[0].baseline.exercises[0].top_weight).toBe(185);
  });

  test('updateRecoveryBlock cannot overwrite the baseline or its identity', async () => {
    const block = await makeBlock();
    const updated = await updateRecoveryBlock(block.id, {
      baseline: { version: 99, exercises: [] },
      baseline_note_id: 'wn_other',
      id: 'rb_hacked',
      saved_at: '1999-01-01T00:00:00.000Z',
      include_in_normal_analytics: true,
    });
    expect(updated.id).toBe(block.id);
    expect(updated.baseline_note_id).toBe('wn_1');
    expect(updated.saved_at).toBe(block.saved_at);
    expect(updated.baseline.version).toBe(RECOVERY_BASELINE_VERSION);
    expect(updated.baseline.exercises).toHaveLength(1);
    // The one mutable field in the patch did apply.
    expect(updated.include_in_normal_analytics).toBe(true);
  });

  test('updateRecoveryBlock advances updated_at', async () => {
    const block = await makeBlock();
    const updated = await updateRecoveryBlock(block.id, { include_in_normal_analytics: true });
    expect(updated.updated_at >= block.updated_at).toBe(true);
  });

  test('updating a missing block rejects', async () => {
    await expect(updateRecoveryBlock('rb_nope', {}))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND });
  });
});

describe('generic updates cannot rewrite lifecycle state', () => {
  test('a stale record spread into updateRecoveryBlock cannot reopen a completed block', async () => {
    const first = await makeBlock();
    const stale = { ...first }; // captured while still active: completed_at === null
    await completeRecoveryBlock(first.id);
    const second = await makeBlock(); // allowed only because `first` is complete

    const updated = await updateRecoveryBlock(first.id, stale);
    expect(updated.completed_at).toBeTruthy();
    // The one-active-block invariant survives: the new block is still the only
    // active one, rather than two blocks now competing.
    expect((await getActiveRecoveryBlock()).id).toBe(second.id);
  });

  test('updateRecoveryBlock cannot clear a tombstone or edit a deleted block', async () => {
    const block = await makeBlock();
    const stale = { ...block };
    await deleteRecoveryBlock(block.id);

    await expect(updateRecoveryBlock(block.id, stale))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND });
    expect((await loadRecoveryBlocksRaw())[0].deleted_at).toBeTruthy();
  });

  test('updateRecoveryBlock cannot move started_at', async () => {
    const block = await makeBlock();
    const updated = await updateRecoveryBlock(block.id, { started_at: '1999-01-01T00:00:00.000Z' });
    expect(updated.started_at).toBe(block.started_at);
  });

  test('a completed block remains patchable for presentation fields', async () => {
    const block = await makeBlock();
    await completeRecoveryBlock(block.id);
    const updated = await updateRecoveryBlock(block.id, { include_in_normal_analytics: true });
    expect(updated.include_in_normal_analytics).toBe(true);
    expect(updated.completed_at).toBeTruthy();
  });

  test('updateRecoveryWeek cannot clear a completion or resurrect a tombstone', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    const stale = { ...week }; // completed_at === null, deleted_at === null
    await completeRecoveryWeek(week.id);

    const updated = await updateRecoveryWeek(week.id, stale);
    expect(updated.completed_at).toBeTruthy();

    await deleteRecoveryWeek(week.id);
    await expect(updateRecoveryWeek(week.id, stale))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.WEEK_NOT_FOUND });
    expect((await loadRecoveryBlockWeeksRaw())[0].deleted_at).toBeTruthy();
  });

  test('a resurrected membership cannot put one note in two blocks', async () => {
    const first = await makeBlock();
    const week = await addRecoveryWeek({ blockId: first.id, noteId: 'wn_shared' });
    const stale = { ...week };
    await deleteRecoveryWeek(week.id);
    await completeRecoveryBlock(first.id);

    const second = await makeBlock();
    await addRecoveryWeek({ blockId: second.id, noteId: 'wn_shared' });

    // The stale patch must not revive the original membership.
    await expect(updateRecoveryWeek(week.id, stale))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.WEEK_NOT_FOUND });
    const live = await loadRecoveryBlockWeeks();
    expect(live.filter(w => w.note_id === 'wn_shared')).toHaveLength(1);
    expect(live[0].block_id).toBe(second.id);
  });
});

describe('assigned week numbers are immutable', () => {
  test('updateRecoveryWeek cannot rewrite an assigned ordinal', async () => {
    const block = await makeBlock();
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    const w2 = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w2' });

    const updated = await updateRecoveryWeek(w2.id, { week_number: 1 });
    expect(updated.week_number).toBe(2);
    expect((await loadRecoveryWeeksForBlock(block.id)).map(w => w.week_number)).toEqual([1, 2]);
  });

  test('updateRecoveryWeek cannot assign a non-positive ordinal', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    const updated = await updateRecoveryWeek(week.id, { week_number: 0 });
    expect(updated.week_number).toBe(1);
  });

  test('ordinals stay unique within a block under repeated patch attempts', async () => {
    const block = await makeBlock();
    for (const noteId of ['wn_a', 'wn_b', 'wn_c']) {
      await addRecoveryWeek({ blockId: block.id, noteId });
    }
    for (const week of await loadRecoveryWeeksForBlock(block.id)) {
      await updateRecoveryWeek(week.id, { week_number: 1 });
    }
    const numbers = (await loadRecoveryWeeksForBlock(block.id)).map(w => w.week_number);
    expect(numbers).toEqual([1, 2, 3]);
    expect(new Set(numbers).size).toBe(3);
  });
});

describe('no-op updates do not mark records dirty', () => {
  test('a patch of only immutable fields leaves updated_at untouched', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });

    const blockAfter = await updateRecoveryBlock(block.id, { id: 'rb_x', baseline: null });
    expect(blockAfter.updated_at).toBe(block.updated_at);

    const weekAfter = await updateRecoveryWeek(week.id, { week_number: 9, note_id: 'wn_z' });
    expect(weekAfter.updated_at).toBe(week.updated_at);
  });

  test('a caller-supplied updated_at is never written', async () => {
    const block = await makeBlock();
    const updated = await updateRecoveryBlock(block.id, {
      include_in_normal_analytics: true,
      updated_at: '1999-01-01T00:00:00.000Z',
    });
    expect(updated.updated_at).not.toBe('1999-01-01T00:00:00.000Z');
    expect(updated.updated_at >= block.updated_at).toBe(true);
  });
});

describe('block completion', () => {
  test('completion is explicit and sets completed_at', async () => {
    const block = await makeBlock();
    expect(block.completed_at).toBeNull();
    const done = await completeRecoveryBlock(block.id);
    expect(done.completed_at).toBeTruthy();
    expect(isBlockActive(done)).toBe(false);
    expect(await getActiveRecoveryBlock()).toBeNull();
  });

  test('adding weeks never completes a block on its own', async () => {
    const block = await makeBlock();
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w2' });
    await completeRecoveryWeek((await loadRecoveryWeeksForBlock(block.id))[0].id);
    expect((await getActiveRecoveryBlock()).completed_at).toBeNull();
  });

  test('re-completing preserves the original completion timestamp', async () => {
    const block = await makeBlock();
    const first = await completeRecoveryBlock(block.id, '2026-05-01T00:00:00.000Z');
    const second = await completeRecoveryBlock(block.id, '2026-06-01T00:00:00.000Z');
    expect(second.completed_at).toBe(first.completed_at);
  });

  test('completing a missing or deleted block rejects', async () => {
    await expect(completeRecoveryBlock('rb_nope'))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND });
    const block = await makeBlock();
    await deleteRecoveryBlock(block.id);
    await expect(completeRecoveryBlock(block.id))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND });
  });
});

describe('block tombstones', () => {
  test('delete tombstones rather than removing the record', async () => {
    const block = await makeBlock();
    await deleteRecoveryBlock(block.id);
    expect(await loadRecoveryBlocks()).toEqual([]);
    const raw = await loadRecoveryBlocksRaw();
    expect(raw).toHaveLength(1);
    expect(raw[0].deleted_at).toBeTruthy();
  });

  test('delete cascades tombstones to the block’s live weeks', async () => {
    const block = await makeBlock();
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w2' });
    await deleteRecoveryBlock(block.id);

    expect(await loadRecoveryBlockWeeks()).toEqual([]);
    const raw = await loadRecoveryBlockWeeksRaw();
    expect(raw).toHaveLength(2);
    expect(raw.every(w => w.deleted_at)).toBe(true);
  });

  test('cascade leaves other blocks’ weeks alone', async () => {
    const first = await makeBlock();
    await addRecoveryWeek({ blockId: first.id, noteId: 'wn_a' });
    await completeRecoveryBlock(first.id);
    const second = await makeBlock();
    await addRecoveryWeek({ blockId: second.id, noteId: 'wn_b' });

    await deleteRecoveryBlock(first.id);
    const live = await loadRecoveryBlockWeeks();
    expect(live.map(w => w.note_id)).toEqual(['wn_b']);
  });

  test('deleting a missing block rejects', async () => {
    await expect(deleteRecoveryBlock('rb_nope'))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND });
  });
});

// ── storage: week memberships ─────────────────────────────────────────────────

describe('addRecoveryWeek — sequential ordering', () => {
  test('assigns positive sequential week numbers', async () => {
    const block = await makeBlock();
    const w1 = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    const w2 = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w2' });
    const w3 = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w3' });
    expect([w1.week_number, w2.week_number, w3.week_number]).toEqual([1, 2, 3]);
    expect(w1.id).toMatch(/^rw_/);
  });

  test('week numbers are assigned by the domain, not the caller', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1', week_number: 99 });
    expect(week.week_number).toBe(1);
  });

  test('loadRecoveryWeeksForBlock returns weeks in order', async () => {
    const block = await makeBlock();
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w2' });
    const ordered = await loadRecoveryWeeksForBlock(block.id);
    expect(ordered.map(w => w.week_number)).toEqual([1, 2]);
    expect(ordered.map(w => w.note_id)).toEqual(['wn_w1', 'wn_w2']);
  });

  test('deleting the last week frees its ordinal for reuse', async () => {
    const block = await makeBlock();
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    const w2 = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w2' });
    await deleteRecoveryWeek(w2.id);
    const replacement = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w3' });
    expect(replacement.week_number).toBe(2);
    // The tombstone keeps its historical ordinal.
    const raw = await loadRecoveryBlockWeeksRaw();
    expect(raw.find(w => w.id === w2.id).week_number).toBe(2);
  });

  test('week numbers are scoped per block', async () => {
    const first = await makeBlock();
    await addRecoveryWeek({ blockId: first.id, noteId: 'wn_a' });
    await addRecoveryWeek({ blockId: first.id, noteId: 'wn_b' });
    await completeRecoveryBlock(first.id);

    const second = await makeBlock();
    const fresh = await addRecoveryWeek({ blockId: second.id, noteId: 'wn_c' });
    expect(fresh.week_number).toBe(1);
  });
});

describe('addRecoveryWeek — membership conflicts', () => {
  test('a note cannot belong to two blocks at once', async () => {
    const first = await makeBlock();
    await addRecoveryWeek({ blockId: first.id, noteId: 'wn_shared' });
    await completeRecoveryBlock(first.id);
    const second = await makeBlock();

    await expect(addRecoveryWeek({ blockId: second.id, noteId: 'wn_shared' }))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.NOTE_ALREADY_IN_BLOCK });
  });

  test('a note cannot be added twice to the same block', async () => {
    const block = await makeBlock();
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    await expect(addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' }))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.NOTE_ALREADY_IN_BLOCK });
    expect(await loadRecoveryWeeksForBlock(block.id)).toHaveLength(1);
  });

  test('removing a note from a block frees it to join another', async () => {
    const first = await makeBlock();
    const week = await addRecoveryWeek({ blockId: first.id, noteId: 'wn_shared' });
    await deleteRecoveryWeek(week.id);
    await completeRecoveryBlock(first.id);

    const second = await makeBlock();
    const rejoined = await addRecoveryWeek({ blockId: second.id, noteId: 'wn_shared' });
    expect(rejoined.block_id).toBe(second.id);
  });

  test('the block’s own baseline routine cannot also be a recovery week', async () => {
    const block = await makeBlock();
    await expect(addRecoveryWeek({ blockId: block.id, noteId: BASELINE_NOTE.id }))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.NOTE_IS_BASELINE });
  });

  test('weeks cannot be added to a missing, completed, or deleted block', async () => {
    await expect(addRecoveryWeek({ blockId: 'rb_nope', noteId: 'wn_w1' }))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND });

    const completed = await makeBlock();
    await completeRecoveryBlock(completed.id);
    await expect(addRecoveryWeek({ blockId: completed.id, noteId: 'wn_w1' }))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_ACTIVE });

    const deleted = await makeBlock();
    await deleteRecoveryBlock(deleted.id);
    await expect(addRecoveryWeek({ blockId: deleted.id, noteId: 'wn_w2' }))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.BLOCK_NOT_ACTIVE });
  });

  test('a week requires a note id', async () => {
    const block = await makeBlock();
    await expect(addRecoveryWeek({ blockId: block.id }))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.INVALID_NOTE_ID });
  });
});

describe('week completion, update, and tombstones', () => {
  test('completing a week is explicit and idempotent on the timestamp', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    expect(week.completed_at).toBeNull();
    const first = await completeRecoveryWeek(week.id, '2026-05-01T00:00:00.000Z');
    const second = await completeRecoveryWeek(week.id, '2026-06-01T00:00:00.000Z');
    expect(second.completed_at).toBe(first.completed_at);
  });

  test('updateRecoveryWeek cannot repoint a membership or its ordinal identity', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    const updated = await updateRecoveryWeek(week.id, {
      id: 'rw_hacked',
      block_id: 'rb_other',
      note_id: 'wn_other',
      saved_at: '1999-01-01T00:00:00.000Z',
      week_number: 7,
      // Completion belongs to completeRecoveryWeek, not to a generic patch.
      completed_at: '2026-05-01T00:00:00.000Z',
    });
    expect(updated.id).toBe(week.id);
    expect(updated.block_id).toBe(block.id);
    expect(updated.note_id).toBe('wn_w1');
    expect(updated.saved_at).toBe(week.saved_at);
    expect(updated.week_number).toBe(1);
    expect(updated.completed_at).toBeNull();
  });

  test('deleted weeks are tombstoned and hidden from user-facing reads', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    await deleteRecoveryWeek(week.id);
    expect(await loadRecoveryBlockWeeks()).toEqual([]);
    expect(await loadRecoveryWeeksForBlock(block.id)).toEqual([]);
    const raw = await loadRecoveryBlockWeeksRaw();
    expect(raw).toHaveLength(1);
    expect(raw[0].deleted_at).toBeTruthy();
  });

  test('re-deleting a week preserves the original tombstone timestamp', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    const first = await deleteRecoveryWeek(week.id);
    const second = await deleteRecoveryWeek(week.id);
    expect(second.deleted_at).toBe(first.deleted_at);
  });

  test('missing week operations reject deterministically', async () => {
    await expect(completeRecoveryWeek('rw_nope'))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.WEEK_NOT_FOUND });
    await expect(updateRecoveryWeek('rw_nope', {}))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.WEEK_NOT_FOUND });
    await expect(deleteRecoveryWeek('rw_nope'))
      .rejects.toMatchObject({ code: RECOVERY_ERROR_CODES.WEEK_NOT_FOUND });
  });
});

// ── raw accessors (cloud sync seam) ───────────────────────────────────────────

describe('raw accessors', () => {
  test('raw reads return the unfiltered list including tombstones', async () => {
    const block = await makeBlock();
    const week = await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    await deleteRecoveryWeek(week.id);
    expect(await loadRecoveryBlocksRaw()).toHaveLength(1);
    expect(await loadRecoveryBlockWeeksRaw()).toHaveLength(1);
  });

  test('raw replace overwrites the backing list', async () => {
    await replaceRecoveryBlocksRaw([{ id: 'rb_x', deleted_at: null, started_at: '2026-01-01' }]);
    await replaceRecoveryBlockWeeksRaw([
      { id: 'rw_x', block_id: 'rb_x', note_id: 'wn_x', week_number: 1, deleted_at: null },
    ]);
    expect((await loadRecoveryBlocks()).map(b => b.id)).toEqual(['rb_x']);
    expect((await loadRecoveryBlockWeeks()).map(w => w.id)).toEqual(['rw_x']);
  });

  test('raw replace coerces a non-array to an empty list', async () => {
    await makeBlock();
    await replaceRecoveryBlocksRaw(null);
    expect(await loadRecoveryBlocksRaw()).toEqual([]);
  });

  test('empty storage reads return empty lists', async () => {
    expect(await loadRecoveryBlocks()).toEqual([]);
    expect(await loadRecoveryBlockWeeks()).toEqual([]);
    expect(await getActiveRecoveryBlock()).toBeNull();
  });

  test('corrupt backing data fails closed rather than reading as empty', async () => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, '{not json');
    await expect(loadRecoveryBlocks()).rejects.toThrow();
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, '{"not":"a list"}');
    await expect(loadRecoveryBlockWeeks()).rejects.toThrow();
  });
});

// ── isolation from existing domains ───────────────────────────────────────────

describe('isolation', () => {
  test('recovery storage never writes workout-note or parser state', async () => {
    const block = await makeBlock();
    await addRecoveryWeek({ blockId: block.id, noteId: 'wn_w1' });
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.sort()).toEqual([RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY].sort());
  });

  test('parsing the baseline note leaves the note text untouched', () => {
    const text = '-Bench\n- 135 5,5\n- 185 3';
    captureRecoveryBaselineFromText(text);
    expect(text).toBe('-Bench\n- 135 5,5\n- 185 3');
    expect(parseWorkoutNote(text).ok).toBe(true);
  });
});
