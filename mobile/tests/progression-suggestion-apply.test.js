import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ThemeProvider } from '../theme/ThemeContext';
import { parseWorkoutNote } from '../lib/parser';
import {
  applyProgressionSuggestionToNoteText,
  MAX_RAW_TEXT_LENGTH,
} from '../lib/parser/workoutNote';
import { deriveProgressionSuggestion } from '../lib/data/progressionSuggestions';
import { ProgressionSuggestionCard } from '../components/ProgressionSuggestionCard';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

// Real derivation output only — never a hand-built record — so the helper is
// exercised against exactly the shape the production pass emits.
function suggestionFor(lines, name, options) {
  const { sections } = parseWorkoutNote(lines.join('\n'));
  return deriveProgressionSuggestion(sections, name, options);
}

// A weighted double-progression record: last two sessions both hit 3x10 at
// 135 lb (top of the 8–10 target) -> "Consider 140 lb for 3x8 next time."
const READY_LINES = ['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'];
const WEIGHTED = suggestionFor(READY_LINES, 'Bench Press');
// Bodyweight ceiling: proposes no weight, so there is nothing to insert.
const BODYWEIGHT = suggestionFor(['-Pull-ups: 3x8-12', '12,12,12', '12,12,12'], 'Pull-ups');
// Not at the ceiling yet: not suggested at all.
const NOT_READY = suggestionFor(['-Row: 3x8-10', '135 8,8,8', '135 8,8,8'], 'Row');

describe('applyProgressionSuggestionToNoteText', () => {
  test('the fixture record is the concrete weighted target it claims to be', () => {
    expect(WEIGHTED.suggested).toBe(true);
    expect(WEIGHTED.heuristic).toMatchObject({
      action: 'increase_weight',
      suggested_weight: 140,
      suggested_sets: 3,
      suggested_reps: 8,
      unit: 'lb',
    });
  });

  test('appends the canonical target row under the matching exercise, rewriting nothing', () => {
    const raw = READY_LINES.join('\n');
    const result = applyProgressionSuggestionToNoteText(raw, WEIGHTED);

    expect(result.applied).toBe(true);
    // Every original line is still present, in order, untouched; exactly one
    // new line was inserted and it is the canonical "weight reps,reps,reps".
    expect(result.text).toBe(`${raw}\n140 8,8,8`);

    const parsed = parseWorkoutNote(result.text);
    expect(parsed.ok).toBe(true);
    const bench = parsed.sections[0].exercises[0];
    expect(bench.name).toBe('Bench Press');
    const last = bench.session_entries[bench.session_entries.length - 1];
    expect(last.skipped).toBeFalsy();
    expect(last.sets.map((s) => [s.weight_value, s.rep_count])).toEqual([
      [140, 8], [140, 8], [140, 8],
    ]);
  });

  test('inserts inside the target block without disturbing later exercises', () => {
    const raw = [
      '-Bench Press: 3x8-10',
      '135 10,10,10',
      '135 10,10,10',
      '-Squat: 3x5-5',
      '225 5,5,5',
    ].join('\n');
    const result = applyProgressionSuggestionToNoteText(raw, WEIGHTED);

    expect(result.applied).toBe(true);
    const before = raw.split('\n');
    const after = result.text.split('\n');
    // One new line, everything else identical and in the same relative order.
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((l) => l === '140 8,8,8')).toHaveLength(1);
    expect(after.filter((l) => l !== '140 8,8,8')).toEqual(before);
    // The new row landed in the Bench block, not after Squat.
    expect(after.indexOf('140 8,8,8')).toBeLessThan(after.indexOf('-Squat: 3x5-5'));

    const parsed = parseWorkoutNote(result.text);
    expect(parsed.sections[0].exercises.map((e) => e.name)).toEqual(['Bench Press', 'Squat']);
    expect(parsed.sections[0].exercises[0].session_entries).toHaveLength(3);
    expect(parsed.sections[0].exercises[1].session_entries).toHaveLength(1);
  });

  test('synthesizes a no-space dash header in canonical grammar when the note has no such exercise', () => {
    const raw = ['-Squat: 3x5-5', '225 5,5,5', '225 5,5,5'].join('\n');
    const result = applyProgressionSuggestionToNoteText(raw, WEIGHTED);

    expect(result.applied).toBe(true);
    expect(result.reason).toBe('synthesized');
    expect(result.text).toBe(`${raw}\n-Bench Press: 3x8-10\n140 8,8,8`);
    // Original content is an exact, untouched prefix.
    expect(result.text.startsWith(`${raw}\n`)).toBe(true);

    const parsed = parseWorkoutNote(result.text);
    expect(parsed.ok).toBe(true);
    const names = parsed.sections[0].exercises.map((e) => e.name);
    expect(names).toEqual(['Squat', 'Bench Press']);
    const bench = parsed.sections[0].exercises[1];
    expect(bench.raw_header).toBe('-Bench Press: 3x8-10');
    expect(bench.session_entries[0].sets.map((s) => [s.weight_value, s.rep_count])).toEqual([
      [140, 8], [140, 8], [140, 8],
    ]);
  });

  test('a repeated apply cannot silently duplicate the target row', () => {
    const raw = READY_LINES.join('\n');
    const once = applyProgressionSuggestionToNoteText(raw, WEIGHTED);
    expect(once.applied).toBe(true);

    const twice = applyProgressionSuggestionToNoteText(once.text, WEIGHTED);
    expect(twice.applied).toBe(false);
    expect(twice.reason).toBe('already-applied');
    expect(twice.text).toBe(once.text);
    expect(once.text.match(/140 8,8,8/g)).toHaveLength(1);
  });

  test('a stale apply after the user logged the target does not overwrite their row', () => {
    // The user has already logged 140x3x8 as their own row; the same suggestion
    // arriving again must not stack or replace it.
    const raw = [...READY_LINES, '140 8,8,8'].join('\n');
    const result = applyProgressionSuggestionToNoteText(raw, WEIGHTED);
    expect(result.applied).toBe(false);
    expect(result.text).toBe(raw);
  });

  test('non-applicable records leave the text byte-identical', () => {
    const raw = READY_LINES.join('\n');
    for (const record of [BODYWEIGHT, NOT_READY, null, undefined, {}, { suggested: true }]) {
      const result = applyProgressionSuggestionToNoteText(raw, record);
      expect(result.applied).toBe(false);
      expect(result.text).toBe(raw);
    }
  });

  test('an oversized note is refused untouched', () => {
    const huge = `${READY_LINES.join('\n')}\n${'x'.repeat(MAX_RAW_TEXT_LENGTH)}`;
    const result = applyProgressionSuggestionToNoteText(huge, WEIGHTED);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('note-too-large');
    expect(result.text).toBe(huge);
  });

  test('a fractional target weight is written in canonical numeric form and reparses', () => {
    // Fractional suggested weights are not reachable through the current
    // derivation, so lock the formatting contract directly against the helper.
    const record = {
      name: 'Bench Press',
      suggested: true,
      heuristic: {
        action: 'increase_weight',
        suggested_weight: 142.5,
        suggested_sets: 3,
        suggested_reps: 8,
        unit: 'lb',
      },
      evidence: { rep_range: { lo: 8, hi: 10, sets: 3 } },
    };
    const raw = READY_LINES.join('\n');
    const result = applyProgressionSuggestionToNoteText(raw, record);
    expect(result.applied).toBe(true);
    expect(result.text).toBe(`${raw}\n142.5 8,8,8`);
    const parsed = parseWorkoutNote(result.text);
    const bench = parsed.sections[0].exercises[0];
    const last = bench.session_entries[bench.session_entries.length - 1];
    expect(last.sets.every((s) => s.weight_value === 142.5 && s.rep_count === 8)).toBe(true);
  });

  test('an empty note becomes a single synthesized block', () => {
    const result = applyProgressionSuggestionToNoteText('', WEIGHTED);
    expect(result.applied).toBe(true);
    expect(result.text).toBe('-Bench Press: 3x8-10\n140 8,8,8');
    expect(parseWorkoutNote(result.text).ok).toBe(true);
  });
});

describe('ProgressionSuggestionCard — Apply to note control', () => {
  async function mount(ui) {
    let root;
    await act(async () => {
      root = renderer.create(<ThemeProvider>{ui}</ThemeProvider>);
    });
    return root;
  }
  const applyButton = (root) => root.root.findAll(
    (n) => n.props.accessibilityRole === 'button'
      && n.props.accessibilityLabel === 'Apply the progression suggestion for Bench Press to your note'
      && typeof n.props.onPress === 'function'
  );

  test('is absent unless the consumer wires onApply', async () => {
    const root = await mount(<ProgressionSuggestionCard suggestion={WEIGHTED} surface="log" />);
    expect(applyButton(root)).toHaveLength(0);
  });

  test('is offered for a concrete weighted target and calls onApply, isolating the press', async () => {
    const onApply = jest.fn();
    const root = await mount(
      <ProgressionSuggestionCard suggestion={WEIGHTED} surface="log" onApply={onApply} />
    );
    const [button] = applyButton(root);
    expect(button).toBeTruthy();
    const evt = { stopPropagation: jest.fn() };
    await act(async () => { button.props.onPress(evt); });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(evt.stopPropagation).toHaveBeenCalled();
  });

  test('is not offered for a bodyweight suggestion even when onApply is wired', async () => {
    const onApply = jest.fn();
    const root = await mount(
      <ProgressionSuggestionCard suggestion={BODYWEIGHT} surface="analytics" onApply={onApply} />
    );
    const anyApply = root.root.findAll(
      (n) => typeof n.props.accessibilityLabel === 'string' && /^Apply the progression suggestion/.test(n.props.accessibilityLabel)
    );
    expect(anyApply).toHaveLength(0);
  });
});
