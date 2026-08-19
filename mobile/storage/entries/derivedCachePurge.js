import { secureStorage as AsyncStorage } from '../secureStorage';
import { WORKOUT_NOTES_KEY } from './keys';
import { stripDerivedSectionsFromList } from './derivedCache';
import { purgeDerivedSectionsFromWorkoutNoteSyncState } from '../syncQueue';
import { markStartupPhase } from './startupTiming';

// Marks the one-time purge as complete on this device (issue #813). Plain
// bookkeeping with no user data in it. It lives under the `kilo_` prefix on
// purpose: a device wipe removes it along with everything else, so a purge
// re-runs (cheaply, over empty tables) after a wipe rather than being assumed.
export const DERIVED_CACHE_PURGE_KEY = 'kilo_derived_sections_purge_v1_complete';
const PURGE_COMPLETE_VALUE = '1';

// One-time startup cleanup of the parser-output cache an older build persisted
// onto workout notes (see derivedCache.js). Three keys can carry it: the
// notebook itself, the workout-notes sync baseline, and the workout-notes
// pending-push queue. Each is rewritten as ONE serialized storage operation
// (secureStorage.updateItem), so nothing can interleave between its read and its
// write; the notebook and its baseline are still separate operations, and the
// sync fingerprint deliberately ignores the field so a device interrupted
// between the two never sees a phantom local edit.
//
// Once complete, later launches pay a single small read for the marker. The
// marker is written only after every key has been processed, so a failure
// (an unreadable encrypted value, for instance) propagates to the caller and the
// purge simply runs again on the next launch. Every notebook write path strips
// the field regardless, so this only ever has to catch up once.
export async function purgePersistedDerivedSections() {
  markStartupPhase('derived-purge:requested');
  const done = await AsyncStorage.getItem(DERIVED_CACHE_PURGE_KEY);
  if (done === PURGE_COMPLETE_VALUE) {
    markStartupPhase('derived-purge:skipped');
    return { skipped: true, notebook: false, snapshot: false, dirty: false };
  }
  const notebook = await AsyncStorage.updateItem(WORKOUT_NOTES_KEY, (raw) => {
    if (raw == null) return null;
    let list;
    try {
      list = JSON.parse(raw);
    } catch {
      // Not this build's job to interpret an unreadable notebook; the read
      // paths surface that. Leave the bytes exactly as they are.
      return null;
    }
    if (!Array.isArray(list)) return null;
    const stripped = stripDerivedSectionsFromList(list);
    return stripped === list ? null : JSON.stringify(stripped);
  });
  const { snapshot, dirty } = await purgeDerivedSectionsFromWorkoutNoteSyncState();
  await AsyncStorage.setItem(DERIVED_CACHE_PURGE_KEY, PURGE_COMPLETE_VALUE);
  markStartupPhase('derived-purge:done');
  return { skipped: false, notebook: notebook.changed, snapshot, dirty };
}
