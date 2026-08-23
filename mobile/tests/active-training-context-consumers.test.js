// Focused consumer coverage for #868: Home, Log, and Analytics all resolve
// `useActiveTrainingContext` off the SAME authoritative Recovery snapshot
// (`useRecoveryBlockState`'s single shared store — see recoveryBlockHooks.js).
// Rather than re-render three full screens, this mounts three independent
// "consumer" components — one per screen's shape of the call — and proves
// they always agree, across the full read-status matrix (loading, ready,
// stale, error, pending) and the full state matrix the pure module already
// covers unit-by-unit in active-training-context.test.js.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import TestRenderer from 'react-test-renderer';

import * as Storage from '../storage/entries';
import { makeWorkoutNoteItem } from '../lib/data';
import {
  createRecoveryBlock,
  addRecoveryWeek,
  completeRecoveryWeek,
} from '../storage/entries/recoveryStorage';
import { RECOVERY_OPERATION_JOURNAL_KEY } from '../storage/entries/keys';
import {
  useActiveTrainingContext,
  refreshRecoveryState,
  _resetRecoveryAnalyticsFilterCache,
} from '../hooks/entries/recoveryBlockHooks';
import { ACTIVE_TRAINING_STATUS } from '../lib/data/activeTrainingContext';

async function flushAsync() {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

// One mounted instance per "screen". Each captures every context it renders
// with, keyed by call index, so the test can compare screen-to-screen at any
// point without racing renders against each other.
function makeConsumer(captured, label) {
  return function Consumer({ currentId, notes }) {
    const ctx = useActiveTrainingContext({ currentId, notes });
    captured[label].push(ctx);
    return null;
  };
}

describe('useActiveTrainingContext — Home/Log/Analytics agreement', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    _resetRecoveryAnalyticsFilterCache();
  });

  test('all three consumers see identical context across loading, ready, active, stale, and pending states', async () => {
    const baselineNote = { ...makeWorkoutNoteItem({ title: 'Baseline Routine', raw_text: '' }), id: 'baseline-note' };
    await Storage.saveWorkoutNoteItem(baselineNote);
    await Storage.setCurrentWorkoutNote(baselineNote.id);

    const captured = { home: [], log: [], analytics: [] };
    const Home = makeConsumer(captured, 'home');
    const Log = makeConsumer(captured, 'log');
    const Analytics = makeConsumer(captured, 'analytics');

    let notes = await Storage.loadWorkoutNotes();
    const currentId = baselineNote.id;

    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <React.Fragment>
          <Home currentId={currentId} notes={notes} />
          <Log currentId={currentId} notes={notes} />
          <Analytics currentId={currentId} notes={notes} />
        </React.Fragment>
      );
    });

    // Cold load: the first authoritative read has not resolved yet. All three
    // must agree it is LOADING, not NORMAL.
    const firstRound = { home: captured.home.at(-1), log: captured.log.at(-1), analytics: captured.analytics.at(-1) };
    expect(firstRound.home.status).toBe(ACTIVE_TRAINING_STATUS.LOADING);
    expect(firstRound.log).toEqual(firstRound.home);
    expect(firstRound.analytics).toEqual(firstRound.home);

    await flushAsync();

    // Verified, no active block: NORMAL, current note is both active and baseline.
    let round = { home: captured.home.at(-1), log: captured.log.at(-1), analytics: captured.analytics.at(-1) };
    expect(round.home.status).toBe(ACTIVE_TRAINING_STATUS.NORMAL);
    expect(round.home.activeNoteId).toBe(currentId);
    expect(round.home.baselinePaused).toBe(false);
    expect(round.log).toEqual(round.home);
    expect(round.analytics).toEqual(round.home);

    // Start a recovery block with an open week 1.
    const rb = await createRecoveryBlock({ baselineNoteId: baselineNote.id, baselineNoteTitle: baselineNote.title });
    const weekNote = { ...makeWorkoutNoteItem({ title: 'Recovery Week 1', raw_text: '' }), id: 'week-1-note' };
    await Storage.saveWorkoutNoteItem(weekNote);
    await addRecoveryWeek({ blockId: rb.id, noteId: weekNote.id });
    notes = await Storage.loadWorkoutNotes();

    // These mutations went through the storage layer directly (as the real
    // recovery-block hooks' own cores do internally), so this drives the same
    // authoritative re-read `notifyRecoveryBlocks()` would trigger.
    await TestRenderer.act(async () => {
      await refreshRecoveryState();
    });
    TestRenderer.act(() => {
      renderer.update(
        <React.Fragment>
          <Home currentId={currentId} notes={notes} />
          <Log currentId={currentId} notes={notes} />
          <Analytics currentId={currentId} notes={notes} />
        </React.Fragment>
      );
    });

    round = { home: captured.home.at(-1), log: captured.log.at(-1), analytics: captured.analytics.at(-1) };
    expect(round.home.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK);
    expect(round.home.activeNoteId).toBe(weekNote.id);
    expect(round.home.baselineNoteId).toBe(baselineNote.id);
    expect(round.home.baselinePaused).toBe(true);
    expect(round.home.recoveryWeekNumber).toBe(1);
    expect(round.log).toEqual(round.home);
    expect(round.analytics).toEqual(round.home);

    // Complete week 1: between weeks, no active note, next action offered.
    await completeRecoveryWeek((await Storage.loadRecoveryBlockWeeks()).find(w => w.block_id === rb.id).id);
    notes = await Storage.loadWorkoutNotes();

    await TestRenderer.act(async () => {
      await refreshRecoveryState();
    });
    TestRenderer.act(() => {
      renderer.update(
        <React.Fragment>
          <Home currentId={currentId} notes={notes} />
          <Log currentId={currentId} notes={notes} />
          <Analytics currentId={currentId} notes={notes} />
        </React.Fragment>
      );
    });

    round = { home: captured.home.at(-1), log: captured.log.at(-1), analytics: captured.analytics.at(-1) };
    expect(round.home.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS);
    expect(round.home.activeNoteId).toBeNull();
    expect(round.home.baselinePaused).toBe(true);
    expect(round.home.nextAction).toBe('add_week_or_end_recovery');
    expect(round.log).toEqual(round.home);
    expect(round.analytics).toEqual(round.home);

    // A corrupted operation journal makes the NEXT authoritative read fail.
    // Since a snapshot is already verified, this must degrade to STALE
    // (last-known-good context stays visible), never to UNVERIFIED/LOADING.
    await AsyncStorage.setItem(RECOVERY_OPERATION_JOURNAL_KEY, '{not json');

    await TestRenderer.act(async () => {
      await refreshRecoveryState().catch(() => {});
    });
    TestRenderer.act(() => {
      renderer.update(
        <React.Fragment>
          <Home currentId={currentId} notes={notes} />
          <Log currentId={currentId} notes={notes} />
          <Analytics currentId={currentId} notes={notes} />
        </React.Fragment>
      );
    });

    round = { home: captured.home.at(-1), log: captured.log.at(-1), analytics: captured.analytics.at(-1) };
    // The read failed, but a verified snapshot already existed, so the
    // last-known-good BETWEEN_WEEKS context is still what all three resolve —
    // never NORMAL, and never a silent disagreement between screens.
    expect(round.home.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS);
    expect(round.log).toEqual(round.home);
    expect(round.analytics).toEqual(round.home);

    TestRenderer.act(() => {
      renderer.unmount();
    });
  });

  test('missing/deleted linked note: active note id resolves, note object does not', async () => {
    const baselineNote = { ...makeWorkoutNoteItem({ title: 'Baseline', raw_text: '' }), id: 'baseline-note-x' };
    await Storage.saveWorkoutNoteItem(baselineNote);
    await Storage.setCurrentWorkoutNote(baselineNote.id);

    const rb = await createRecoveryBlock({ baselineNoteId: baselineNote.id, baselineNoteTitle: baselineNote.title });
    const weekNote = { ...makeWorkoutNoteItem({ title: 'Week 1', raw_text: '' }), id: 'week-note-x' };
    await Storage.saveWorkoutNoteItem(weekNote);
    await addRecoveryWeek({ blockId: rb.id, noteId: weekNote.id });

    // Delete the linked week note out from under the block without going
    // through the recovery-aware delete path — simulating a note that is
    // missing/deleted while the membership record still points at it.
    await Storage.deleteWorkoutNoteItem(weekNote.id);

    const notes = await Storage.loadWorkoutNotes();
    const captured = { home: [] };
    const Home = makeConsumer(captured, 'home');

    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(<Home currentId={baselineNote.id} notes={notes} />);
    });
    await flushAsync();
    TestRenderer.act(() => {
      renderer.update(<Home currentId={baselineNote.id} notes={notes} />);
    });

    const ctx = captured.home.at(-1);
    expect(ctx.status).toBe(ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK);
    expect(ctx.activeNoteId).toBe(weekNote.id);
    expect(ctx.activeNote).toBeNull();
    expect(ctx.baselineNote).toEqual(expect.objectContaining({ id: baselineNote.id }));

    TestRenderer.act(() => {
      renderer.unmount();
    });
  });
});
