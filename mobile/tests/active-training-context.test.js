import {
  ACTIVE_TRAINING_STATUS,
  deriveActiveTrainingContext,
  resolveActiveTrainingContext,
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
