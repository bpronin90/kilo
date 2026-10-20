// #1475: a session check-in is resolved against the latest note under the
// notebook lock, so a sibling check-in persisted after the modal opened (the
// modal's `currentNote` is a stale draft) survives the save. Real storage, both
// adapter paths; only the Supabase client is mocked.
import React from 'react';
import { act } from 'react';
import render from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import * as Storage from '../storage/entries';
import * as LocalNotes from '../storage/entries/workoutNotes';
import * as CloudNotes from '../storage/cloud/cloudDomainMethods';
import * as SyncQueue from '../storage/syncQueue';
import { getDirtyRecords, SYNC_TABLES } from '../storage/syncQueue';

jest.mock('../lib/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: 'MaterialIcons' }));
jest.mock('../components/UI', () => ({ createInputStyle: () => ({}) }));

const NOTE = { id: 'n1', title: 'Upper', raw_text: 'Monday\n-Bench 3x5', notes_extra: 'keep me' };
const SIBLING = { status: 'rough', reasons: ['sleep'], responded_at: '2026-01-01T00:00:00.000Z' };

const checkInData = sessionIndex => ({
  sessionIndex,
  detectors: ['volume_drop'],
  flagged: [{ name: 'Squat', normName: 'squat', reasons: ['volume_drop'] }],
  metrics: { exercises_skipped: 0, volume_decline_pct: 40 },
});

const byId = async id => (await Storage.loadWorkoutNotesRaw()).find(n => n.id === id);

function findPressableWithText(root, text) {
  return root.findAll(node => typeof node.props?.onPress === 'function', { deep: true }).find(node =>
    node.findAll(n => n.props?.children === text, { deep: true }).length > 0
  );
}

// Opens the modal on session 0 with the note as it was at open time, then
// lets `between` run (another writer) before pressing Done.
async function saveSessionZero(api, staleNote, between = async () => {}) {
  const onClose = jest.fn();
  const update = jest.fn((id, patch) => api.updateWorkoutNoteItem(id, patch));
  let instance;
  await act(async () => {
    instance = render.create(
      <SessionCheckInModal visible checkInData={checkInData(0)} currentId="n1" currentNote={staleNote} update={update} onClose={onClose} />
    );
  });
  await between();
  await act(async () => { findPressableWithText(instance.root, 'Normal for me').props.onPress(); });
  await act(async () => { findPressableWithText(instance.root, 'Done').props.onPress(); });
  const errorShown = instance.root.findAll(n => n.props?.children === 'Could not save. Please try again.', { deep: true }).length > 0;
  act(() => { instance.unmount(); });
  return { onClose, errorShown };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe.each([
  ['local', LocalNotes],
  ['cloud', CloudNotes],
])('%s session check-in save', (mode, api) => {
  test('a sibling check-in persisted after the modal opened survives', async () => {
    await api.saveWorkoutNoteItem({ ...NOTE, session_checkins: {} });
    const staleNote = await byId('n1');
    const { onClose, errorShown } = await saveSessionZero(api, staleNote, () =>
      api.updateWorkoutNoteItem('n1', { session_checkins: { 1: SIBLING } })
    );
    expect(errorShown).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    const saved = await byId('n1');
    expect(saved.session_checkins[1]).toEqual(SIBLING);
    expect(saved.session_checkins[0]).toEqual(expect.objectContaining({ status: 'ok' }));
    expect(saved.raw_text).toBe(NOTE.raw_text);
    expect(saved.notes_extra).toBe('keep me');
    if (mode === 'cloud') {
      const dirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
      const queued = dirty.find(r => r.id === 'n1');
      expect(Object.keys(queued.session_checkins).sort()).toEqual(['0', '1']);
    }
  });

  test('a same-session edit keeps the explicit overwrite', async () => {
    await api.saveWorkoutNoteItem({ ...NOTE, session_checkins: { 0: SIBLING } });
    const { onClose } = await saveSessionZero(api, await byId('n1'));
    expect(onClose).toHaveBeenCalledTimes(1);
    const saved = await byId('n1');
    expect(saved.session_checkins[0]).toEqual(expect.objectContaining({ status: 'ok', reasons: [] }));
  });

  test('a note deleted after the modal opened is reported, not resurrected', async () => {
    await api.saveWorkoutNoteItem({ ...NOTE, session_checkins: {} });
    const staleNote = await byId('n1');
    const { onClose, errorShown } = await saveSessionZero(api, staleNote, () => api.deleteWorkoutNoteItem('n1'));
    expect(errorShown).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    const after = await byId('n1');
    expect(after === undefined || !!after.deleted_at).toBe(true);
    expect(await api.loadWorkoutNotes()).toEqual([]);
  });
});

test('cloud: an enqueue rejection does not report completion', async () => {
  await CloudNotes.saveWorkoutNoteItem({ ...NOTE, session_checkins: {} });
  const staleNote = await byId('n1');
  jest.spyOn(SyncQueue, 'enqueueDirty').mockRejectedValueOnce(new Error('queue write failed'));
  const { onClose, errorShown } = await saveSessionZero(CloudNotes, staleNote);
  expect(errorShown).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

test('local: a failed notebook write does not report completion', async () => {
  await LocalNotes.saveWorkoutNoteItem({ ...NOTE, session_checkins: {} });
  const staleNote = await byId('n1');
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  const { onClose, errorShown } = await saveSessionZero(LocalNotes, staleNote);
  expect(errorShown).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  expect((await byId('n1')).session_checkins).toEqual({});
});
