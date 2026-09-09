// Id-stable workout-note creation across a partial cloud write (#997).
//
// In cloud mode `saveWorkoutNoteItem` writes the local row and only then awaits
// `enqueueDirty`, and the enqueue can reject on its own. The caller therefore
// sees a failure after the routine already exists on the device with no intent
// to upload it, and a blind retry used to mint a second id and duplicate the
// routine.
//
// The correlation key is an explicit per-attempt token the caller mints, keeps
// across the failure, restores after an app restart, and clears only on full
// success. The properties under test are exactly the ones the payload-keyed
// attempt could not hold at the same time:
//
//   - a retry that EDITED the title or body is still the same attempt;
//   - a genuinely new routine with byte-identical text always gets its own id;
//   - neither guarantee depends on a TTL, an age-out, or a time window;
//   - the durable store is concurrency-safe, so overlapping creates, retries,
//     and clears never lose or reassign another pending attempt.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import render from 'react-test-renderer';

import * as Storage from '../storage/entries';
import * as workoutNotesStorage from '../storage/entries/workoutNotes';
import {
  ensureWorkoutNoteCreationAttempt,
  loadWorkoutNoteCreationAttempt,
  claimWorkoutNoteCreationAttemptId,
  loadWorkoutNoteCreationAttemptId,
  clearWorkoutNoteCreationAttempt,
  clearAllWorkoutNoteCreationAttempts,
} from '../storage/entries/workoutNoteCreationAttempts';
import { setLocalDataOwner } from '../storage/entries/localDataOwner';
import { secureStorage } from '../storage/secureStorage';
import { useWorkoutNotes } from '../hooks/entries/workoutNoteHooks';

const ATTEMPTS_KEY = 'kilo_workout_note_creation_attempts_v1';

async function readAttemptsState() {
  const raw = await AsyncStorage.getItem(ATTEMPTS_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('the durable creation-attempt store', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('mints a token, persists it, and hands the same one back until it is cleared', async () => {
    const token = await ensureWorkoutNoteCreationAttempt('import');
    expect(typeof token).toBe('string');
    expect(token).not.toHaveLength(0);

    // The durable slot is authoritative: a second create in the same context
    // continues the unfinished attempt instead of clobbering it with a fresh
    // token, which is what a retry depends on even when the caller's in-memory
    // restore has not landed yet.
    await expect(ensureWorkoutNoteCreationAttempt('import')).resolves.toBe(token);
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBe(token);
  });

  test('a restored token completes the attempt it was minted for, and only that one', async () => {
    const token = await ensureWorkoutNoteCreationAttempt('other:new');
    await claimWorkoutNoteCreationAttemptId(token, 'wn_first');

    // "App restart": nothing in memory, only what is on disk.
    const restored = await loadWorkoutNoteCreationAttempt('other:new');
    expect(restored).toBe(token);
    await expect(claimWorkoutNoteCreationAttemptId(restored, 'wn_second'))
      .resolves.toBe('wn_first');
  });

  test('clearing a completed attempt frees the context for a genuinely new create', async () => {
    const first = await ensureWorkoutNoteCreationAttempt('import');
    await claimWorkoutNoteCreationAttemptId(first, 'wn_first');
    await clearWorkoutNoteCreationAttempt('import', first);

    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
    await expect(loadWorkoutNoteCreationAttemptId(first)).resolves.toBeNull();

    const second = await ensureWorkoutNoteCreationAttempt('import');
    expect(second).not.toBe(first);
    await expect(claimWorkoutNoteCreationAttemptId(second, 'wn_second'))
      .resolves.toBe('wn_second');
  });

  test('claiming an id is get-or-set: the first claim wins, every retry is handed it back', async () => {
    const token = await ensureWorkoutNoteCreationAttempt('current:new');
    await expect(claimWorkoutNoteCreationAttemptId(token, 'wn_a')).resolves.toBe('wn_a');
    await expect(claimWorkoutNoteCreationAttemptId(token, 'wn_b')).resolves.toBe('wn_a');
    await expect(claimWorkoutNoteCreationAttemptId(token, 'wn_c')).resolves.toBe('wn_a');
    await expect(loadWorkoutNoteCreationAttemptId(token)).resolves.toBe('wn_a');
  });

  test('overlapping claims for one token converge on a single id', async () => {
    const token = await ensureWorkoutNoteCreationAttempt('current:new');
    const claimed = await Promise.all([
      claimWorkoutNoteCreationAttemptId(token, 'wn_1'),
      claimWorkoutNoteCreationAttemptId(token, 'wn_2'),
      claimWorkoutNoteCreationAttemptId(token, 'wn_3'),
    ]);
    expect(new Set(claimed).size).toBe(1);
    await expect(loadWorkoutNoteCreationAttemptId(token)).resolves.toBe(claimed[0]);
  });

  test('overlapping mints across contexts never drop another context’s pending attempt', async () => {
    const [a, b, c] = await Promise.all([
      ensureWorkoutNoteCreationAttempt('current:new'),
      ensureWorkoutNoteCreationAttempt('other:new'),
      ensureWorkoutNoteCreationAttempt('import'),
    ]);
    expect(new Set([a, b, c]).size).toBe(3);
    await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBe(a);
    await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBe(b);
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBe(c);
  });

  test('overlapping clears retire only their own attempt', async () => {
    const [a, b, c] = await Promise.all([
      ensureWorkoutNoteCreationAttempt('current:new'),
      ensureWorkoutNoteCreationAttempt('other:new'),
      ensureWorkoutNoteCreationAttempt('import'),
    ]);
    await Promise.all([
      claimWorkoutNoteCreationAttemptId(a, 'wn_a'),
      claimWorkoutNoteCreationAttemptId(b, 'wn_b'),
      claimWorkoutNoteCreationAttemptId(c, 'wn_c'),
    ]);

    await Promise.all([
      clearWorkoutNoteCreationAttempt('current:new', a),
      clearWorkoutNoteCreationAttempt('import', c),
    ]);

    await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBeNull();
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
    // The untouched attempt keeps both halves of its record.
    await expect(loadWorkoutNoteCreationAttempt('other:new')).resolves.toBe(b);
    await expect(loadWorkoutNoteCreationAttemptId(b)).resolves.toBe('wn_b');
  });

  test('a completed attempt never clears a newer attempt that already took its slot', async () => {
    const stale = await ensureWorkoutNoteCreationAttempt('import');
    await claimWorkoutNoteCreationAttemptId(stale, 'wn_stale');
    await clearWorkoutNoteCreationAttempt('import', stale);
    const fresh = await ensureWorkoutNoteCreationAttempt('import');
    await claimWorkoutNoteCreationAttemptId(fresh, 'wn_fresh');

    // A late completion for the retired attempt must not strand the live one.
    await clearWorkoutNoteCreationAttempt('import', stale);
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBe(fresh);
    await expect(loadWorkoutNoteCreationAttemptId(fresh)).resolves.toBe('wn_fresh');
  });

  test('an attempt has no TTL, age-out, or expiry field of any kind', async () => {
    const token = await ensureWorkoutNoteCreationAttempt('import');
    await claimWorkoutNoteCreationAttemptId(token, 'wn_aged');

    const state = await readAttemptsState();
    const serialized = JSON.stringify(state);
    for (const field of ['at', 'savedAt', 'createdAt', 'expiresAt', 'ttl']) {
      expect(serialized).not.toContain(`"${field}"`);
    }

    // Ten years later it is still the same unfinished create.
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 365 * 24 * 3600 * 1000);
    try {
      await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBe(token);
      await expect(claimWorkoutNoteCreationAttemptId(token, 'wn_other')).resolves.toBe('wn_aged');
    } finally {
      now.mockRestore();
    }
  });

  test('corrupt or absent state degrades to “nothing is pending”', async () => {
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
    await expect(loadWorkoutNoteCreationAttemptId('wnca_nope')).resolves.toBeNull();

    await AsyncStorage.setItem(ATTEMPTS_KEY, '{not json');
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
    // And it recovers by minting rather than throwing.
    await expect(ensureWorkoutNoteCreationAttempt('import')).resolves.toEqual(expect.any(String));
  });

  test('another owner’s pending attempt is neither visible, reassigned, nor stranded', async () => {
    await setLocalDataOwner('user-a');
    const ownedByA = await ensureWorkoutNoteCreationAttempt('import');
    await claimWorkoutNoteCreationAttemptId(ownedByA, 'wn_a');

    // A different account cannot see the attempt, cannot claim its id, and its
    // own create in the SAME context gets a separate slot rather than
    // overwriting one it is not allowed to complete.
    await setLocalDataOwner('user-b');
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
    await expect(loadWorkoutNoteCreationAttemptId(ownedByA)).resolves.toBeNull();
    const ownedByB = await ensureWorkoutNoteCreationAttempt('import');
    expect(ownedByB).not.toBe(ownedByA);
    await clearWorkoutNoteCreationAttempt('import', ownedByB);

    await setLocalDataOwner('user-a');
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBe(ownedByA);
    await expect(loadWorkoutNoteCreationAttemptId(ownedByA)).resolves.toBe('wn_a');
  });

  test('a store that cannot persist the attempt REJECTS rather than resolving empty', async () => {
    // A create performed without a durable token is an uncorrelated create —
    // the duplicate this whole protocol exists to prevent — so the store must
    // never let a caller proceed as if an attempt had been recorded.
    const failing = jest.spyOn(secureStorage, 'updateItem')
      .mockRejectedValue(new Error('device storage unavailable'));
    try {
      await expect(ensureWorkoutNoteCreationAttempt('import')).rejects.toThrow();
      await expect(clearWorkoutNoteCreationAttempt('import', 'wnca_1_1')).rejects.toThrow();
    } finally {
      failing.mockRestore();
    }
    // And nothing was recorded, so the next create starts clean.
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
  });

  test('clearAllWorkoutNoteCreationAttempts wipes every context (account-transition safety net)', async () => {
    await ensureWorkoutNoteCreationAttempt('current:new');
    await ensureWorkoutNoteCreationAttempt('import');
    await clearAllWorkoutNoteCreationAttempts();
    await expect(loadWorkoutNoteCreationAttempt('current:new')).resolves.toBeNull();
    await expect(loadWorkoutNoteCreationAttempt('import')).resolves.toBeNull();
  });
});

// ── useWorkoutNotes.add ──────────────────────────────────────────────────────
//
// The partial cloud write is modelled at the write seam, the way
// weight-screen.test.js models the same shape for weight entries: the local row
// persists exactly as the cloud adapter writes it, and then the call rejects the
// way a failed `enqueueDirty` makes it reject. That is the whole outcome `add`
// has to survive, and it needs no transport, no session, and no network.

describe('useWorkoutNotes.add after a partial cloud write', () => {
  let realSave;
  let failNextSave;

  function NotesProbe({ onReady }) {
    const hook = useWorkoutNotes();
    onReady(hook);
    return null;
  }

  // Every mounted probe is unmounted in afterEach. useWorkoutNotes registers
  // module-level notify/reload listeners, so a leaked instance keeps issuing
  // storage reads during later tests and can hand a coalesced, pre-write
  // snapshot to the call under test.
  let mountedTrees = [];

  async function mountNotes() {
    let hook = null;
    let tree;
    await render.act(async () => {
      tree = render.create(<NotesProbe onReady={(h) => { hook = h; }} />);
    });
    mountedTrees.push(tree);
    return { tree, api: () => hook };
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    failNextSave = false;
    realSave = workoutNotesStorage.saveWorkoutNoteItem;
    jest.spyOn(workoutNotesStorage, 'saveWorkoutNoteItem').mockImplementation(async (note) => {
      // The local row lands first, exactly as in cloud mode…
      await realSave(note);
      // …and only the cloud half fails.
      if (failNextSave) {
        failNextSave = false;
        throw new Error('enqueue failed');
      }
    });
  });

  afterEach(async () => {
    await render.act(async () => {
      mountedTrees.forEach((tree) => tree.unmount());
    });
    mountedTrees = [];
    await quiesce(2);
    jest.restoreAllMocks();
  });

  async function liveNotes() {
    return Storage.loadWorkoutNotes();
  }

  // useWorkoutNotes fans every successful write out to all mounted instances,
  // each of which re-reads the notebook. Draining those before the test writes
  // to the notebook itself keeps the sequence under test deterministic.
  async function quiesce(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await render.act(async () => { await Promise.resolve(); await Promise.resolve(); });
    }
  }

  test('a retry carrying the same token completes the original create, leaving one note', async () => {
    const { api } = await mountNotes();
    const token = await ensureWorkoutNoteCreationAttempt('import');

    failNextSave = true;
    await expect(api().add('Upper/Lower', 'Monday\n-Bench Press\n- 135 5', { attemptToken: token }))
      .rejects.toThrow('enqueue failed');

    const stranded = await liveNotes();
    expect(stranded).toHaveLength(1);
    const strandedId = stranded[0].id;

    let retried;
    await render.act(async () => {
      retried = await api().add('Upper/Lower', 'Monday\n-Bench Press\n- 135 5', { attemptToken: token });
    });
    expect(retried.id).toBe(strandedId);

    const after = await liveNotes();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(strandedId);
  });

  test('editing the title, the body, or both before retrying is still the same attempt', async () => {
    const { api } = await mountNotes();
    const token = await ensureWorkoutNoteCreationAttempt('import');

    failNextSave = true;
    await expect(api().add('Typo Nmae', 'Monday\n-Bench Press\n- 135 5', { attemptToken: token }))
      .rejects.toThrow('enqueue failed');
    const strandedId = (await liveNotes())[0].id;

    await render.act(async () => {
      await api().add('Fixed Name', 'Monday\n-Bench Press\n- 145 5', { attemptToken: token });
    });

    const after = await liveNotes();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(strandedId);
    expect(after[0].title).toBe('Fixed Name');
    expect(after[0].raw_text).toBe('Monday\n-Bench Press\n- 145 5');
  });

  test('a retry after an app restart, with the payload edited, still completes the original note', async () => {
    const first = await mountNotes();
    const token = await ensureWorkoutNoteCreationAttempt('import');

    failNextSave = true;
    await expect(first.api().add('Draft', 'Monday\n-Squat\n- 225 5', { attemptToken: token }))
      .rejects.toThrow('enqueue failed');
    const strandedId = (await liveNotes())[0].id;

    // Restart: the mounted instance is gone and the token comes back from disk.
    await render.act(async () => { first.tree.unmount(); });
    mountedTrees = mountedTrees.filter((tree) => tree !== first.tree);
    const restored = await loadWorkoutNoteCreationAttempt('import');
    expect(restored).toBe(token);

    const second = await mountNotes();
    await render.act(async () => {
      await second.api().add('Squat Day', 'Monday\n-Squat\n- 235 5', { attemptToken: restored });
    });

    const after = await liveNotes();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(strandedId);
    expect(after[0].title).toBe('Squat Day');
    expect(after[0].raw_text).toBe('Monday\n-Squat\n- 235 5');
  });

  test('a new attempt gets its own id even when the title and body are byte-identical', async () => {
    const { api } = await mountNotes();
    const TITLE = 'Upper/Lower';
    const BODY = 'Monday\n-Bench Press\n- 135 5';

    const first = await ensureWorkoutNoteCreationAttempt('import');
    let firstNote;
    await render.act(async () => {
      firstNote = await api().add(TITLE, BODY, { attemptToken: first });
    });
    await clearWorkoutNoteCreationAttempt('import', first);

    // Immediately importing the very same routine again is a NEW routine.
    const second = await ensureWorkoutNoteCreationAttempt('import');
    expect(second).not.toBe(first);
    let secondNote;
    await render.act(async () => {
      secondNote = await api().add(TITLE, BODY, { attemptToken: second });
    });

    expect(secondNote.id).not.toBe(firstNote.id);
    const after = await liveNotes();
    expect(after).toHaveLength(2);
    expect(new Set(after.map((n) => n.id)).size).toBe(2);
  });

  test('a create with no token never adopts a pending attempt’s id', async () => {
    // Every other create path in the app (App.js's `saveWorkout`, for one)
    // passes no token and must keep behaving exactly as it did: its own id,
    // never the one an unfinished attempt is holding.
    const { api } = await mountNotes();
    const token = await ensureWorkoutNoteCreationAttempt('import');

    failNextSave = true;
    await expect(api().add('Stranded', 'Monday\n-Squat\n- 225 5', { attemptToken: token }))
      .rejects.toThrow('enqueue failed');
    const strandedId = (await liveNotes())[0].id;

    let plain;
    // makeWorkoutNoteItem derives the id from Date.now(), so advance the clock
    // to keep this assertion about the ATTEMPT store rather than about two
    // creates happening to land in the same millisecond.
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60000);
    await render.act(async () => {
      plain = await api().add('Unrelated', 'Tuesday\n-Row\n- 95 8');
    });
    clock.mockRestore();

    expect(plain.id).not.toBe(strandedId);
    expect(await liveNotes()).toHaveLength(2);
    // And the unfinished attempt is untouched by it.
    await expect(loadWorkoutNoteCreationAttemptId(token)).resolves.toBe(strandedId);
  });

  test('the stranded row is completed in place, not rebuilt from scratch', async () => {
    // Seeded directly to the exact state a stranded create leaves behind — the
    // row is on the device and the attempt is still bound to it — plus a field
    // the first attempt (or a later reconciliation pass) stamped on that row.
    // Completing the create must carry the latest submitted text WITHOUT
    // discarding what is already there.
    const { api } = await mountNotes();
    const token = await ensureWorkoutNoteCreationAttempt('other:new');
    await claimWorkoutNoteCreationAttemptId(token, 'wn_stranded');
    await realSave({
      id: 'wn_stranded',
      title: 'Draft',
      raw_text: 'Monday\n-Squat\n- 225 5',
      activeWeek: 'B',
      saved_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    });

    let completed;
    await render.act(async () => {
      completed = await api().add('Draft', 'Monday\n-Squat\n- 245 5', { attemptToken: token });
    });
    expect(completed.id).toBe('wn_stranded');
    expect(completed.activeWeek).toBe('B');
    expect(completed.saved_at).toBe('2026-09-01T00:00:00.000Z');
    expect(completed.updated_at).not.toBe('2026-09-01T00:00:00.000Z');

    const after = await liveNotes();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('wn_stranded');
    expect(after[0].raw_text).toBe('Monday\n-Squat\n- 245 5');
    expect(after[0].activeWeek).toBe('B');
  });
});
