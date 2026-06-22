import { parseWorkoutNote } from '../../lib/parser';

const noteSectionsCache = new Map();

export function getNoteSections(note) {
  if (!note || !note.raw_text) return [];
  const key = note.id != null ? note.id : note.raw_text;
  const cached = noteSectionsCache.get(key);
  if (cached && cached.raw_text === note.raw_text) {
    return cached.sections;
  }
  const { sections } = parseWorkoutNote(note.raw_text);
  noteSectionsCache.set(key, { raw_text: note.raw_text, sections });
  return sections;
}
