import { parseWorkoutNote } from '../../lib/parser/workoutPure';

// Bound: a few thousand notes covers a long training history on one device
// (several years of daily logging) while keeping retained parsed data finite.
// Evicted entries simply reparse to equivalent output on next access.
export const NOTE_SECTIONS_CACHE_LIMIT = 2000;

// Map iteration order is insertion order, so the first key is the least
// recently used one as long as hits re-insert their key.
const noteSectionsCache = new Map();

export function getNoteSections(note) {
  if (!note || !note.raw_text) return [];
  const key = note.id != null ? note.id : note.raw_text;
  const cached = noteSectionsCache.get(key);
  if (cached && cached.raw_text === note.raw_text) {
    noteSectionsCache.delete(key);
    noteSectionsCache.set(key, cached);
    return cached.sections;
  }
  const { sections } = parseWorkoutNote(note.raw_text);
  noteSectionsCache.delete(key);
  noteSectionsCache.set(key, { raw_text: note.raw_text, sections });
  while (noteSectionsCache.size > NOTE_SECTIONS_CACHE_LIMIT) {
    noteSectionsCache.delete(noteSectionsCache.keys().next().value);
  }
  return sections;
}

// Test seam: observe the cache size without exposing the Map.
export function getNoteSectionsCacheSize() {
  return noteSectionsCache.size;
}
