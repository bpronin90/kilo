// #881 (F10a/F10b): exercise-to-source navigation. Extends the parser and
// WorkoutContentRenderer coverage with the anchor build/resolve contract and
// the double-tap gesture, per issue #879 comment 5399648016 (the F10a
// contract) and issue #881's focused test matrix (§7). Tests 14-17 in that
// matrix are iOS/Android device-only and are not present here.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import {
  parseWorkoutNote,
  hashSourceSlice,
  sliceNoteWeekText,
  headerLineCharRange,
  buildExerciseSourceAnchor,
  resolveExerciseSourceAnchor,
} from '../lib/parser';
import { WorkoutContentRenderer } from '../components/WorkoutContentRenderer';

function buildDayGroups(sections) {
  const groups = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (last && last.heading === section.heading) {
      last.sections.push(section);
    } else {
      groups.push({ heading: section.heading, sections: [section] });
    }
  }
  return groups;
}

// ── headerLineCharRange / sliceNoteWeekText / hashSourceSlice ──────────────

describe('headerLineCharRange', () => {
  test('computes the start/end offsets of a 1-based line', () => {
    const text = 'aaa\nbbbb\ncc';
    // line 1: "aaa" -> 0..3, line 2: "bbbb" -> 4..8, line 3: "cc" -> 9..11
    expect(headerLineCharRange(text, 1)).toEqual({ start: 0, end: 3 });
    expect(headerLineCharRange(text, 2)).toEqual({ start: 4, end: 8 });
    expect(headerLineCharRange(text, 3)).toEqual({ start: 9, end: 11 });
  });

  test('returns null for an out-of-range or invalid line number', () => {
    expect(headerLineCharRange('a\nb', 5)).toBeNull();
    expect(headerLineCharRange('a\nb', 0)).toBeNull();
    expect(headerLineCharRange('a\nb', null)).toBeNull();
  });
});

describe('sliceNoteWeekText', () => {
  test('splits on a standalone --- line', () => {
    const text = 'Week A stuff\nmore\n---\nWeek B stuff';
    expect(sliceNoteWeekText(text, 0)).toBe('Week A stuff\nmore');
    expect(sliceNoteWeekText(text, 1)).toBe('Week B stuff');
  });

  test('returns the full text unchanged when there is no separator', () => {
    const text = 'Just one week';
    expect(sliceNoteWeekText(text, 0)).toBe(text);
    expect(sliceNoteWeekText(text, 1)).toBe(text);
  });
});

describe('hashSourceSlice', () => {
  test('is stable for identical text', () => {
    expect(hashSourceSlice('-Bench Press\n135 5,5,5')).toBe(hashSourceSlice('-Bench Press\n135 5,5,5'));
  });

  test('changes when the text changes', () => {
    expect(hashSourceSlice('-Bench Press')).not.toBe(hashSourceSlice('-Bench press'));
  });
});

// ── buildExerciseSourceAnchor / resolveExerciseSourceAnchor ────────────────

describe('exercise source anchor: build + resolve (F10a §1-3)', () => {
  test('1. two exercises sharing a name in different sections land on their own occurrence', () => {
    const text = [
      'Monday',
      '-Bench Press',
      '135 5,5,5',
      'Tuesday',
      '-Bench Press',
      '95 5,5,5',
    ].join('\n');
    const parsed = parseWorkoutNote(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.sections).toHaveLength(2);

    const anchorA = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text,
      sectionIndex: 0, exerciseOrdinal: 0, exercise: parsed.sections[0].exercises[0],
    });
    const anchorB = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text,
      sectionIndex: 1, exerciseOrdinal: 0, exercise: parsed.sections[1].exercises[0],
    });

    const rangeA = resolveExerciseSourceAnchor(anchorA, { noteId: 'n1', weekIndex: 0, sliceText: text });
    const rangeB = resolveExerciseSourceAnchor(anchorB, { noteId: 'n1', weekIndex: 0, sliceText: text });
    expect(rangeA).not.toBeNull();
    expect(rangeB).not.toBeNull();
    expect(rangeA).not.toEqual(rangeB);
    expect(text.slice(rangeA.start, rangeA.end)).toBe('-Bench Press');
    expect(text.slice(rangeB.start, rangeB.end)).toBe('-Bench Press');
    expect(rangeA.start).toBeLessThan(rangeB.start);
  });

  test('2. Week B anchor resolves against the Week B slice only, Week A untouched', () => {
    const full = ['-Squat', '225 5,5,5', '---', '-Deadlift', '315 5'].join('\n');
    const weekAText = sliceNoteWeekText(full, 0);
    const weekBText = sliceNoteWeekText(full, 1);
    const parsedB = parseWorkoutNote(weekBText);
    const anchor = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 1, sliceText: weekBText,
      sectionIndex: 0, exerciseOrdinal: 0, exercise: parsedB.sections[0].exercises[0],
    });
    // Resolving against Week A's text (wrong slice) must fail even though
    // noteId superficially looks plausible if weekIndex is wrong.
    expect(resolveExerciseSourceAnchor(anchor, { noteId: 'n1', weekIndex: 0, sliceText: weekAText })).toBeNull();
    const range = resolveExerciseSourceAnchor(anchor, { noteId: 'n1', weekIndex: 1, sliceText: weekBText });
    expect(range).not.toBeNull();
    expect(weekBText.slice(range.start, range.end)).toBe('-Deadlift');
  });

  test('3. same normalized movement under two different headings resolves within its own section', () => {
    const text = ['Monday', '-bench press', '135 5', 'Tuesday', '-Bench Press', '145 5'].join('\n');
    const parsed = parseWorkoutNote(text);
    const anchor0 = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text,
      sectionIndex: 0, exerciseOrdinal: 0, exercise: parsed.sections[0].exercises[0],
    });
    const anchor1 = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text,
      sectionIndex: 1, exerciseOrdinal: 0, exercise: parsed.sections[1].exercises[0],
    });
    const r0 = resolveExerciseSourceAnchor(anchor0, { noteId: 'n1', weekIndex: 0, sliceText: text });
    const r1 = resolveExerciseSourceAnchor(anchor1, { noteId: 'n1', weekIndex: 0, sliceText: text });
    expect(text.slice(r0.start, r0.end)).toBe('-bench press');
    expect(text.slice(r1.start, r1.end)).toBe('-Bench Press');
  });

  test('6. ordinal 0 and ordinal length-1 both resolve, including when the last header is the final line', () => {
    const text = ['Monday', '-Squat', '225 5', '-Bench', '135 5', '-Row'].join('\n');
    const parsed = parseWorkoutNote(text);
    const exercises = parsed.sections[0].exercises;
    expect(exercises).toHaveLength(3);
    const firstAnchor = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text, sectionIndex: 0, exerciseOrdinal: 0, exercise: exercises[0],
    });
    const lastAnchor = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text,
      sectionIndex: 0, exerciseOrdinal: exercises.length - 1, exercise: exercises[exercises.length - 1],
    });
    const firstRange = resolveExerciseSourceAnchor(firstAnchor, { noteId: 'n1', weekIndex: 0, sliceText: text });
    const lastRange = resolveExerciseSourceAnchor(lastAnchor, { noteId: 'n1', weekIndex: 0, sliceText: text });
    expect(text.slice(firstRange.start, firstRange.end)).toBe('-Squat');
    expect(text.slice(lastRange.start, lastRange.end)).toBe('-Row');
    // The final exercise header is the last line of the raw text.
    expect(lastRange.end).toBe(text.length);
  });

  test('5. header still a valid target when the exercise block contains invalid/unparsed rows', () => {
    const text = ['Monday', '-Bench Press', 'not a real row', '135 5,5,5'].join('\n');
    const parsed = parseWorkoutNote(text);
    const exercise = parsed.sections[0].exercises[0];
    expect(
      exercise.unparsed_rows.length + (exercise.unparsed_positions || []).length
    ).toBeGreaterThan(0);
    const anchor = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text, sectionIndex: 0, exerciseOrdinal: 0, exercise,
    });
    const range = resolveExerciseSourceAnchor(anchor, { noteId: 'n1', weekIndex: 0, sliceText: text });
    expect(text.slice(range.start, range.end)).toBe('-Bench Press');
  });

  test('7. stale anchor: mutated raw text between tap and open is discarded, never dereferenced', () => {
    const text = ['Monday', '-Bench Press', '135 5,5,5'].join('\n');
    const parsed = parseWorkoutNote(text);
    const anchor = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text, sectionIndex: 0, exerciseOrdinal: 0,
      exercise: parsed.sections[0].exercises[0],
    });
    const mutatedText = ['Monday', '-Squat', '225 5', '-Bench Press', '135 5,5,5'].join('\n');
    expect(resolveExerciseSourceAnchor(anchor, { noteId: 'n1', weekIndex: 0, sliceText: mutatedText })).toBeNull();
  });

  test('8. shifted identical headers are still caught by the sliceRevision gate, not just header text', () => {
    const text = ['Monday', '-Curl', '30 10,10,10', '-Curl', '25 10,10,10'].join('\n');
    const parsed = parseWorkoutNote(text);
    // Anchor the SECOND "-Curl" occurrence (ordinal 1).
    const anchor = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text, sectionIndex: 0, exerciseOrdinal: 1,
      exercise: parsed.sections[0].exercises[1],
    });
    // Insert a line above both occurrences: ordinal 1 still points at *a*
    // "-Curl" line (header text still matches) but it is a DIFFERENT physical
    // occurrence than the one tapped — the sliceRevision mismatch must
    // reject this before the positional tuple is trusted.
    const shifted = ['Monday', '-Row', '40 10', '-Curl', '30 10,10,10', '-Curl', '25 10,10,10'].join('\n');
    expect(resolveExerciseSourceAnchor(anchor, { noteId: 'n1', weekIndex: 0, sliceText: shifted })).toBeNull();
  });

  test('8b. wrong note/week is discarded at step 1, never dereferenced', () => {
    const text = ['Monday', '-Bench Press', '135 5,5,5'].join('\n');
    const parsed = parseWorkoutNote(text);
    const anchor = buildExerciseSourceAnchor({
      noteId: 'note-a', weekIndex: 0, sliceText: text, sectionIndex: 0, exerciseOrdinal: 0,
      exercise: parsed.sections[0].exercises[0],
    });
    expect(resolveExerciseSourceAnchor(anchor, { noteId: 'note-b', weekIndex: 0, sliceText: text })).toBeNull();
    expect(resolveExerciseSourceAnchor(anchor, { noteId: 'note-a', weekIndex: 1, sliceText: text })).toBeNull();
  });

  test('stale: exercise removed from the section entirely resolves to null, not a different occurrence', () => {
    const text = ['Monday', '-Bench Press', '135 5,5,5'].join('\n');
    const parsed = parseWorkoutNote(text);
    const anchor = buildExerciseSourceAnchor({
      noteId: 'n1', weekIndex: 0, sliceText: text, sectionIndex: 0, exerciseOrdinal: 0,
      exercise: parsed.sections[0].exercises[0],
    });
    const edited = ['Monday', '-Squat', '225 5'].join('\n');
    expect(resolveExerciseSourceAnchor(anchor, { noteId: 'n1', weekIndex: 0, sliceText: edited })).toBeNull();
  });

  test('Recovery note anchors resolve through the identical algorithm as a baseline note', () => {
    const text = ['Monday', '-Band Pull Apart', '15,15,15'].join('\n');
    const parsed = parseWorkoutNote(text);
    const anchor = buildExerciseSourceAnchor({
      noteId: 'recovery-note', weekIndex: 0, sliceText: text, sectionIndex: 0, exerciseOrdinal: 0,
      exercise: parsed.sections[0].exercises[0],
    });
    const range = resolveExerciseSourceAnchor(anchor, { noteId: 'recovery-note', weekIndex: 0, sliceText: text });
    expect(text.slice(range.start, range.end)).toBe('-Band Pull Apart');
  });
});

// ── WorkoutContentRenderer double-tap gesture (F10a §5) ─────────────────────

function renderWithDayGroups(sections, extraProps = {}) {
  const dayGroups = buildDayGroups(sections);
  let renderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(WorkoutContentRenderer, { dayGroups, ...extraProps })
    );
  });
  return renderer;
}

function findExerciseNameText(renderer, name) {
  return renderer.root.findAll(
    node => node.type === Text && node.props.children === name
  )[0];
}

function doubleTap(node) {
  act(() => { node.props.onPress(); });
  act(() => { node.props.onPress(); });
}

describe('WorkoutContentRenderer exercise double-tap (F10a §5, §7 9-10)', () => {
  const text = ['Monday', '-Bench Press', 'not a real row', '135 5,5,5'].join('\n');

  test('double-tap on the exercise name calls onExercisePress with a valid anchor', () => {
    const parsed = parseWorkoutNote(text);
    const onExercisePress = jest.fn();
    const renderer = renderWithDayGroups(parsed.sections, {
      sourceNoteId: 'n1', sourceWeekIndex: 0, sourceSliceText: text, onExercisePress,
    });
    const nameText = findExerciseNameText(renderer, 'Bench Press');
    expect(nameText).toBeTruthy();
    doubleTap(nameText);
    expect(onExercisePress).toHaveBeenCalledTimes(1);
    const anchor = onExercisePress.mock.calls[0][0];
    const range = resolveExerciseSourceAnchor(anchor, { noteId: 'n1', weekIndex: 0, sliceText: text });
    expect(text.slice(range.start, range.end)).toBe('-Bench Press');
  });

  test('9. single tap on the exercise header does not navigate', () => {
    const parsed = parseWorkoutNote(text);
    const onExercisePress = jest.fn();
    const renderer = renderWithDayGroups(parsed.sections, {
      sourceNoteId: 'n1', sourceWeekIndex: 0, sourceSliceText: text, onExercisePress,
    });
    const nameText = findExerciseNameText(renderer, 'Bench Press');
    act(() => { nameText.props.onPress(); });
    expect(onExercisePress).not.toHaveBeenCalled();
  });

  test('10. double-tap on a set row does not navigate (header-only target)', () => {
    const parsed = parseWorkoutNote(text);
    const onExercisePress = jest.fn();
    const renderer = renderWithDayGroups(parsed.sections, {
      sourceNoteId: 'n1', sourceWeekIndex: 0, sourceSliceText: text, onExercisePress,
    });
    // Nothing besides the one exercise-name Text found above ever receives
    // onNamePress/onPress from this component. Assert no navigation ever
    // fires from any other pressable text node (set rows, unparsed rows).
    const allTextNodes = renderer.root.findAllByType(Text);
    const nonNameNodes = allTextNodes.filter(n => n.props.children !== 'Bench Press');
    nonNameNodes.forEach(n => {
      if (typeof n.props.onPress === 'function') {
        act(() => { n.props.onPress(); });
        act(() => { n.props.onPress(); });
      }
    });
    expect(onExercisePress).not.toHaveBeenCalled();
  });

  test('gesture is inert (no anchor built, no onPress wired) when source-jump props are omitted — e.g. Deload views', () => {
    const parsed = parseWorkoutNote(text);
    const renderer = renderWithDayGroups(parsed.sections); // no sourceNoteId/onExercisePress
    const nameText = findExerciseNameText(renderer, 'Bench Press');
    expect(nameText.props.onPress).toBeUndefined();
  });

  test('4. an exercise inside a compact (Recovery) render uses the same anchor/resolution algorithm', () => {
    const parsed = parseWorkoutNote(text);
    const onExercisePress = jest.fn();
    const renderer = renderWithDayGroups(parsed.sections, {
      sourceNoteId: 'recovery-note', sourceWeekIndex: 0, sourceSliceText: text, onExercisePress, compact: true,
    });
    const nameText = findExerciseNameText(renderer, 'Bench Press');
    doubleTap(nameText);
    expect(onExercisePress).toHaveBeenCalledTimes(1);
    const anchor = onExercisePress.mock.calls[0][0];
    expect(anchor.noteId).toBe('recovery-note');
    const range = resolveExerciseSourceAnchor(anchor, { noteId: 'recovery-note', weekIndex: 0, sliceText: text });
    expect(text.slice(range.start, range.end)).toBe('-Bench Press');
  });
});
