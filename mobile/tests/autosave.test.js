import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadWorkoutNotes,
  saveWorkoutNoteItem,
  loadCurrentWorkoutId,
  setCurrentWorkoutNote,
} from '../storage/entries';

// ── autosave debounce behavior ─────────────────────────────────────────────────

describe('autosave debounce pattern', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('fires once after debounce window when scheduled multiple times', () => {
    const save = jest.fn();
    const DEBOUNCE_MS = 800;
    let timerId = null;

    const schedule = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        timerId = null;
        save();
      }, DEBOUNCE_MS);
    };

    schedule();
    jest.advanceTimersByTime(400);
    schedule();
    jest.advanceTimersByTime(400);
    schedule();

    expect(save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('canceling the pending timer prevents the save', () => {
    const save = jest.fn();
    const DEBOUNCE_MS = 800;
    let timerId = null;

    const schedule = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        timerId = null;
        save();
      }, DEBOUNCE_MS);
    };

    const cancel = () => {
      const wasPending = timerId !== null;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      return wasPending;
    };

    schedule();
    expect(cancel()).toBe(true);
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(save).not.toHaveBeenCalled();
  });

  test('manual flush: cancel timer and save immediately', async () => {
    const save = jest.fn().mockResolvedValue(true);
    const DEBOUNCE_MS = 800;
    let timerId = null;

    const schedule = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(async () => {
        timerId = null;
        await save();
      }, DEBOUNCE_MS);
    };

    const flush = async () => {
      const wasPending = timerId !== null;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (wasPending) await save();
    };

    schedule();
    jest.advanceTimersByTime(200); // well before debounce fires
    await flush(); // simulate Done button press

    expect(save).toHaveBeenCalledTimes(1);
    // Advancing past the debounce window does not fire a second time.
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('no save fires when no changes are pending', () => {
    const save = jest.fn();
    const DEBOUNCE_MS = 800;
    let timerId = null;

    // Simulate "no unsaved changes" guard: schedule is not called
    jest.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(timerId).toBeNull();
  });
});

// ── storage persistence for autosave use case ─────────────────────────────────

describe('saveWorkoutNoteItem autosave persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('persists raw_text updates made by autosave', async () => {
    const note = {
      id: 'wn_test_1',
      title: 'Push Day',
      raw_text: 'Bench Press 135x5',
      saved_at: '2026-06-04T10:00:00.000Z',
      updated_at: '2026-06-04T10:00:00.000Z',
      isCurrent: true,
    };

    await saveWorkoutNoteItem(note);
    const updatedNote = { ...note, raw_text: 'Bench Press 145x5\nOHP 95x5' };
    await saveWorkoutNoteItem(updatedNote);

    const list = await loadWorkoutNotes();
    expect(list).toHaveLength(1);
    expect(list[0].raw_text).toBe('Bench Press 145x5\nOHP 95x5');
  });

  test('rapid autosave writes converge to the latest content', async () => {
    const base = {
      id: 'wn_test_2',
      title: 'Squat Day',
      raw_text: '',
      saved_at: '2026-06-04T10:00:00.000Z',
      updated_at: '2026-06-04T10:00:00.000Z',
      isCurrent: true,
    };

    await saveWorkoutNoteItem(base);

    // Simulate three rapid autosave writes (as the user types)
    for (const text of ['Squat', 'Squat 225', 'Squat 225x5']) {
      await saveWorkoutNoteItem({ ...base, raw_text: text });
    }

    const list = await loadWorkoutNotes();
    expect(list[0].raw_text).toBe('Squat 225x5');
  });

  test('autosave does not duplicate the note in the list', async () => {
    const note = {
      id: 'wn_test_3',
      title: 'Pull Day',
      raw_text: 'Deadlift 225x5',
      saved_at: '2026-06-04T10:00:00.000Z',
      updated_at: '2026-06-04T10:00:00.000Z',
      isCurrent: true,
    };

    await saveWorkoutNoteItem(note);
    await saveWorkoutNoteItem({ ...note, raw_text: 'Deadlift 245x5' });
    await saveWorkoutNoteItem({ ...note, raw_text: 'Deadlift 265x5' });

    const list = await loadWorkoutNotes();
    expect(list).toHaveLength(1);
    expect(list[0].raw_text).toBe('Deadlift 265x5');
  });

  test('autosave preserves other notes in the list', async () => {
    const note1 = {
      id: 'wn_test_4a',
      title: 'Push',
      raw_text: 'Bench',
      saved_at: '2026-06-04T10:00:00.000Z',
      updated_at: '2026-06-04T10:00:00.000Z',
      isCurrent: true,
    };
    const note2 = {
      id: 'wn_test_4b',
      title: 'Pull',
      raw_text: 'Row',
      saved_at: '2026-06-04T10:00:00.000Z',
      updated_at: '2026-06-04T10:00:00.000Z',
      isCurrent: false,
    };

    await saveWorkoutNoteItem(note1);
    await saveWorkoutNoteItem(note2);

    // Autosave only updates note1
    await saveWorkoutNoteItem({ ...note1, raw_text: 'Bench Press 135x5' });

    const list = await loadWorkoutNotes();
    expect(list).toHaveLength(2);
    const saved1 = list.find(n => n.id === 'wn_test_4a');
    const saved2 = list.find(n => n.id === 'wn_test_4b');
    expect(saved1.raw_text).toBe('Bench Press 135x5');
    expect(saved2.raw_text).toBe('Row');
  });
});
