import {
  ACTIVE_TRAINING_STATUS,
  deriveActiveTrainingContext,
  resolveActiveTrainingContext,
  selectProvisionalRecovery,
  arePersistedRecoveryRecordsWellFormed,
} from '../lib/data/activeTrainingContext';
import { buildRecoveryBlock, buildRecoveryWeek } from '../lib/data/recoveryBlocks';

function block(overrides = {}) {
  return {
    ...buildRecoveryBlock({ baselineNoteId: 'baseline-note', now: '2026-01-01T00:00:00.000Z' }),
    ...overrides,
  };
}

function week({ blockId, noteId, weekNumber, completedAt = null, id }) {
  return {
    ...buildRecoveryWeek({ blockId, noteId, weekNumber, now: '2026-01-01T00:00:00.000Z' }),
    ...(id ? { id } : {}),
    completed_at: completedAt,
  };
}

describe('deriveActiveTrainingContext', () => {
  test('cold load: not yet verified resolves to loading, never normal', () => {
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: false, recoveryLoading: true });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.LOADING);
    expect(ctx.activeNoteId).toBeNull();
    expect(ctx.baselinePaused).toBeNull();
  });

  test('unverified first-load failure resolves to unverified, never normal', () => {
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: false, recoveryLoading: false });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.UNVERIFIED);
    expect(ctx.activeNoteId).toBeNull();
    expect(ctx.baselinePaused).toBeNull();
  });

  test('normal: verified, no active block', () => {
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: true, activeBlock: null, weeks: [] });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.NORMAL);
    expect(ctx.activeNoteId).toBe('note-1');
    expect(ctx.baselineNoteId).toBe('note-1');
    expect(ctx.baselinePaused).toBe(false);
    expect(ctx.recoveryWeekNumber).toBeNull();
  });

  test('open week: active block with an in-progress latest week', () => {
    const b = block({ id: 'rb1' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1', weekNumber: 1, completedAt: '2026-01-08T00:00:00.000Z', id: 'rw1' });
    const w2 = week({ blockId: 'rb1', noteId: 'note-w2', weekNumber: 2, completedAt: null, id: 'rw2' });
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: true, activeBlock: b, weeks: [w1, w2] });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK);
    expect(ctx.activeNoteId).toBe('note-w2');
    expect(ctx.baselineNoteId).toBe('baseline-note');
    expect(ctx.baselinePaused).toBe(true);
    expect(ctx.recoveryWeekNumber).toBe(2);
    expect(ctx.nextAction).toBeNull();
  });

  test('completed week with no next week: between weeks, next action offered', () => {
    const b = block({ id: 'rb1' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1', weekNumber: 1, completedAt: '2026-01-08T00:00:00.000Z', id: 'rw1' });
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: true, activeBlock: b, weeks: [w1] });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS);
    expect(ctx.activeNoteId).toBeNull();
    expect(ctx.baselineNoteId).toBe('baseline-note');
    expect(ctx.baselinePaused).toBe(true);
    expect(ctx.recoveryWeekNumber).toBe(1);
    expect(ctx.nextAction).toBe('add_week_or_end_recovery');
  });

  test('add week: a newly attached open week supersedes the completed one', () => {
    const b = block({ id: 'rb1' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1', weekNumber: 1, completedAt: '2026-01-08T00:00:00.000Z', id: 'rw1' });
    const w2 = week({ blockId: 'rb1', noteId: 'note-w2', weekNumber: 2, completedAt: null, id: 'rw2' });
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: true, activeBlock: b, weeks: [w1, w2] });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK);
    expect(ctx.recoveryWeekNumber).toBe(2);
  });

  test('end recovery: no active block returns to the stored current routine, unpaused', () => {
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: true, activeBlock: null, weeks: [] });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.NORMAL);
    expect(ctx.baselinePaused).toBe(false);
    expect(ctx.activeNoteId).toBe('note-1');
  });

  test('stale + no active block: never resolves as normal, but still exposes last-known-good shape', () => {
    const ctx = deriveActiveTrainingContext({
      currentId: 'note-1', recoveryReady: true, recoveryStale: true, activeBlock: null, weeks: [],
    });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.STALE);
    expect(ctx.status).not.toBe(ACTIVE_TRAINING_STATUS.NORMAL);
    expect(ctx.stale).toBe(true);
    // Last-known-good shape is still exposed, just not claimed as confirmed.
    expect(ctx.activeNoteId).toBe('note-1');
    expect(ctx.baselinePaused).toBe(false);
  });

  test('pending + no active block: never resolves as normal', () => {
    const ctx = deriveActiveTrainingContext({
      currentId: 'note-1', recoveryReady: true, pendingRecovery: [{ id: 'op1' }], activeBlock: null, weeks: [],
    });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.PENDING);
    expect(ctx.status).not.toBe(ACTIVE_TRAINING_STATUS.NORMAL);
    expect(ctx.pending).toBe(true);
  });

  test('failed (unverified) never resolves as normal even with a currentId set', () => {
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: false, recoveryLoading: false });
    expect(ctx.status).not.toBe(ACTIVE_TRAINING_STATUS.NORMAL);
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.UNVERIFIED);
  });

  test('stale still shown alongside an active open week: status stays recovery_open_week, stale flag propagates', () => {
    const b = block({ id: 'rb1' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1', weekNumber: 1, completedAt: null, id: 'rw1' });
    const ctx = deriveActiveTrainingContext({
      currentId: 'note-1', recoveryReady: true, recoveryStale: true, activeBlock: b, weeks: [w1],
    });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK);
    expect(ctx.stale).toBe(true);
    expect(ctx.activeNoteId).toBe('note-w1');
  });

  test('pending still shown alongside an active between-weeks block: status unchanged, pending flag propagates', () => {
    const b = block({ id: 'rb1' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1', weekNumber: 1, completedAt: '2026-01-08T00:00:00.000Z', id: 'rw1' });
    const ctx = deriveActiveTrainingContext({
      currentId: 'note-1', recoveryReady: true, pendingRecovery: [{ id: 'op1' }], activeBlock: b, weeks: [w1],
    });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS);
    expect(ctx.pending).toBe(true);
  });

  test('clean verified normal state exposes stale:false and pending:false', () => {
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: true, activeBlock: null, weeks: [] });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.NORMAL);
    expect(ctx.stale).toBe(false);
    expect(ctx.pending).toBe(false);
  });

  test('week ordering is structural (live ordered memberships), not array order', () => {
    const b = block({ id: 'rb1' });
    // Deliberately inserted out of order.
    const w2 = week({ blockId: 'rb1', noteId: 'note-w2', weekNumber: 2, completedAt: null, id: 'rw2' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1', weekNumber: 1, completedAt: '2026-01-08T00:00:00.000Z', id: 'rw1' });
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: true, activeBlock: b, weeks: [w2, w1] });
    expect(ctx.activeNoteId).toBe('note-w2');
    expect(ctx.recoveryWeekNumber).toBe(2);
  });

  test('a tombstoned latest week is excluded from the ordering', () => {
    const b = block({ id: 'rb1' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1', weekNumber: 1, completedAt: null, id: 'rw1' });
    const w2Deleted = { ...week({ blockId: 'rb1', noteId: 'note-w2', weekNumber: 2, completedAt: null, id: 'rw2' }), deleted_at: '2026-01-09T00:00:00.000Z' };
    const ctx = deriveActiveTrainingContext({ currentId: 'note-1', recoveryReady: true, activeBlock: b, weeks: [w1, w2Deleted] });
    expect(ctx.activeNoteId).toBe('note-w1');
    expect(ctx.recoveryWeekNumber).toBe(1);
  });
});

describe('resolveActiveTrainingContext', () => {
  test('resolves active and baseline note objects from the notes array', () => {
    const b = block({ id: 'rb1' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1', weekNumber: 1, completedAt: null, id: 'rw1' });
    const notes = [
      { id: 'baseline-note', title: 'Baseline Routine' },
      { id: 'note-w1', title: 'Week 1' },
    ];
    const ctx = resolveActiveTrainingContext({
      currentId: 'note-1', notes, recoveryReady: true, activeBlock: b, weeks: [w1],
    });
    expect(ctx.activeNote).toEqual(notes[1]);
    expect(ctx.baselineNote).toEqual(notes[0]);
  });

  test('missing/deleted linked notes resolve to null rather than throwing', () => {
    const b = block({ id: 'rb1' });
    const w1 = week({ blockId: 'rb1', noteId: 'note-w1-deleted', weekNumber: 1, completedAt: null, id: 'rw1' });
    const notes = [{ id: 'baseline-note', title: 'Baseline Routine' }];
    const ctx = resolveActiveTrainingContext({
      currentId: 'note-1', notes, recoveryReady: true, activeBlock: b, weeks: [w1],
    });
    expect(ctx.activeNoteId).toBe('note-w1-deleted');
    expect(ctx.activeNote).toBeNull();
    expect(ctx.baselineNote).toEqual(notes[0]);
  });

  test('normal state resolves the current note as both active and baseline', () => {
    const notes = [{ id: 'note-1', title: 'Current Routine' }];
    const ctx = resolveActiveTrainingContext({
      currentId: 'note-1', notes, recoveryReady: true, activeBlock: null, weeks: [],
    });
    expect(ctx.activeNote).toEqual(notes[0]);
    expect(ctx.baselineNote).toEqual(notes[0]);
    expect(ctx.baselinePaused).toBe(false);
  });

  test('loading/unverified states resolve no note objects', () => {
    const notes = [{ id: 'note-1', title: 'Current Routine' }];
    const loading = resolveActiveTrainingContext({ currentId: 'note-1', notes, recoveryReady: false, recoveryLoading: true });
    expect(loading.activeNote).toBeNull();
    expect(loading.baselineNote).toBeNull();
    expect(loading.status).toBe(ACTIVE_TRAINING_STATUS.LOADING);
  });
});

// #1366: a bounded persisted read may answer for display while the first
// authoritative pass is pending — only when internally consistent, and never
// after that pass has failed.
describe('provisional display context (#1366)', () => {
  const b = block({ id: 'b1' });
  const open = week({ blockId: 'b1', noteId: 'w1', weekNumber: 1, id: 'wk1' });
  const pendingRead = (provisional) => deriveActiveTrainingContext({
    currentId: 'note-1', recoveryReady: false, recoveryLoading: true, provisional,
  });

  test('a consistent Recovery read gives the persisted week, flagged provisional', () => {
    const ctx = pendingRead({ blocks: [b], weeks: [open] });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK);
    expect(ctx.recoveryWeekNumber).toBe(1);
    expect(ctx.provisional).toBe(true);
  });

  test('an empty consistent read is a provisional normal, not a verified one', () => {
    const ctx = pendingRead({ blocks: [], weeks: [] });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.NORMAL);
    expect(ctx.provisional).toBe(true);
  });

  test('inconsistent reads are unknown: two active blocks, duplicate weeks, orphan or out-of-order weeks', () => {
    const cases = [
      { blocks: [b, block({ id: 'b2' })], weeks: [] },
      { blocks: [b], weeks: [open, week({ blockId: 'b1', noteId: 'w2', weekNumber: 1, id: 'wk2' })] },
      { blocks: [b], weeks: [week({ blockId: 'gone', noteId: 'w1', weekNumber: 1, id: 'wk3' })] },
      { blocks: [b], weeks: [open, week({ blockId: 'b1', noteId: 'w2', weekNumber: 2, id: 'wk4' })] },
      // One note with two live memberships (distinct weeks, earlier completed).
      { blocks: [b], weeks: [
        week({ blockId: 'b1', noteId: 'w1', weekNumber: 1, id: 'wk5', completedAt: '2026-01-02T00:00:00.000Z' }),
        week({ blockId: 'b1', noteId: 'w1', weekNumber: 2, id: 'wk6' }),
      ] },
      // Malformed persisted ordinals and identities are not a week to show.
      { blocks: [b], weeks: [{ ...open, week_number: 0 }] },
      { blocks: [b], weeks: [{ ...open, week_number: 1.5 }] },
      { blocks: [b], weeks: [{ ...open, week_number: '1' }] },
      { blocks: [b], weeks: [{ ...open, note_id: null }] },
      // Ambiguous identities: one block id with conflicting lifecycle state,
      // duplicate or missing week ids, a week of a tombstoned block.
      { blocks: [b, { ...b, completed_at: '2026-10-01T00:00:00.000Z' }], weeks: [open] },
      { blocks: [b], weeks: [open, { ...open, note_id: 'w9' }] },
      { blocks: [b], weeks: [{ ...open, id: undefined }] },
      { blocks: [{ ...b, id: 7 }], weeks: [] },
      { blocks: [b, block({ id: 'b0', deleted_at: '2026-10-01T00:00:00.000Z' })],
        weeks: [open, week({ blockId: 'b0', noteId: 'w8', weekNumber: 1, id: 'wk8' })] },
      // A week whose note is its own block's frozen baseline (NOTE_IS_BASELINE).
      { blocks: [b], weeks: [{ ...open, note_id: b.baseline_note_id }] },
      // Empty identities are not identities.
      { blocks: [{ ...b, baseline_note_id: '' }], weeks: [] },
      { blocks: [b], weeks: [{ ...open, note_id: '' }] },
      { blocks: [{ ...b, id: '' }], weeks: [] },
      { blocks: [b], weeks: [{ ...open, id: '' }] },
      // Duplicate ordinals on a COMPLETED block still make the data inconsistent.
      { blocks: [{ ...b, completed_at: '2026-10-01T00:00:00.000Z' }], weeks: [
        week({ blockId: 'b1', noteId: 'r1', weekNumber: 1, id: 'c1', completedAt: '2026-09-01T00:00:00.000Z' }),
        week({ blockId: 'b1', noteId: 'r2', weekNumber: 1, id: 'c2' }),
      ] },
      // Malformed lifecycle fields: truthiness must not decide the mode.
      { blocks: [{ ...b, completed_at: {} }], weeks: [] },
      { blocks: [{ ...b, completed_at: 'not a date' }], weeks: [] },
      { blocks: [{ ...b, deleted_at: 1 }], weeks: [] },
      { blocks: [{ ...b, baseline_note_id: null }], weeks: [] },
      { blocks: [{ ...b, include_in_normal_analytics: 'yes' }], weeks: [] },
      { blocks: [b], weeks: [{ ...open, completed_at: [] }] },
      { blocks: [b], weeks: [{ ...open, deleted_at: true }] },
      { blocks: null, weeks: [] },
    ];
    for (const provisional of cases) {
      expect(selectProvisionalRecovery(provisional).consistent).toBe(false);
      const ctx = pendingRead(provisional);
      expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.UNVERIFIED);
      expect(ctx.baselinePaused).toBeNull();
    }
  });

  test('a failed authoritative read ignores the provisional data entirely', () => {
    const ctx = deriveActiveTrainingContext({
      currentId: 'note-1', recoveryReady: false, recoveryLoading: false, provisional: { blocks: [], weeks: [] },
    });
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.UNVERIFIED);
    expect(ctx.provisional).toBeUndefined();
  });

  test('no provisional read yet stays loading', () => {
    expect(pendingRead(null).status).toBe(ACTIVE_TRAINING_STATUS.LOADING);
  });
});

describe('raw persisted record check (#1366)', () => {
  const b = block({ id: 'b1' });
  test('accepts well-formed records, tombstones included', () => {
    expect(arePersistedRecoveryRecordsWellFormed(
      [b, { ...block({ id: 'b2' }), deleted_at: '2026-10-01T00:00:00.000Z' }], []
    )).toBe(true);
  });
  test('rejects malformed markers and identities that the filtered readers would hide', () => {
    for (const raw of [
      [{ ...b, deleted_at: {} }], [{ ...b, deleted_at: 1 }], [{ ...b, deleted_at: 'not a date' }],
      [{ ...b, completed_at: [] }], [{ ...b, id: 3 }], [null],
      [{ ...b, baseline_note_id: '' }], [{ ...b, include_in_normal_analytics: 'yes' }],
    ]) expect(arePersistedRecoveryRecordsWellFormed(raw, [])).toBe(false);
    const w = week({ blockId: 'b1', noteId: 'n1', weekNumber: 1, id: 'w1' });
    expect(arePersistedRecoveryRecordsWellFormed([b], [w])).toBe(true);
    for (const bad of [{ week_number: 'x' }, { week_number: 1.5 }, { note_id: '' }, { block_id: null }]) {
      expect(arePersistedRecoveryRecordsWellFormed([b], [{ ...w, ...bad }])).toBe(false);
    }
    expect(arePersistedRecoveryRecordsWellFormed([], null)).toBe(false);
  });
});
