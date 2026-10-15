import React from 'react';
import render, { act } from 'react-test-renderer';
import {
  buildExerciseNameNormalizationPrompt,
  buildKiloRoutineFormatPrompt,
  buildRoutinePlanningPrompt,
  ROUTINE_PROMPT_FORMAT_GUIDE,
} from '../lib/interoperability/routinePrompts';
import { Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAX_RAW_TEXT_LENGTH } from '../lib/parser';
import { RoutinePromptToolsScreen } from '../components/RoutinePromptToolsScreen';
import { PromptFlow } from '../components/routinePromptTools/PromptFlow';
import { RoutinePicker } from '../components/routinePromptTools/RoutinePicker';
import { PromptDisclosureToggle } from '../components/routinePromptTools/PromptDisclosure';
import * as Storage from '../storage/entries';
import { applyWorkoutNoteTextBatchIfUnchanged, compareAndSetWorkoutNoteText } from '../storage/entries/workoutNotes';

jest.mock('../lib/reminderScheduler', () => ({ reconcileWorkoutReminder: () => Promise.resolve() }));

const CURRENT = { id: 'current', title: 'Upper', raw_text: 'Monday\n-Bench Press\n- 135 5 *PR\n-- keep tight\n---\nTuesday\n-Squat\n- 185 -' };
const TARGET = { id: 'target', title: 'Upper', raw_text: 'Monday\n-Bench press\n- 135 5 *PR\n-- keep tight\n---\nTuesday\n-Squat\n- 185 -' };

function button(root, label) {
  return root.findAll(node => node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
}

function byTestId(root, testID) {
  return root.findAll(node => node.props?.testID === testID && typeof node.props.onPress === 'function')[0];
}

// Open a picker's bottom sheet, tap the given routine ids, then Done.
async function choose(tree, key, ids) {
  await act(async () => { byTestId(tree.root, `routine-picker-${key}`).props.onPress(); });
  for (const id of ids) await act(async () => { byTestId(tree.root, `routine-picker-${key}-option-${id}`).props.onPress(); });
  const done = tree.root.findAll(node => /^Done choosing/.test(node.props?.accessibilityLabel || '') && typeof node.props.onPress === 'function')[0];
  await act(async () => { done.props.onPress(); });
}

// The prompt text is collapsed reference content; expand it before reading.
function promptOutput(root) {
  if (!root.findAll(node => node.props?.testID === 'routine-prompt-output').length) {
    act(() => { byTestId(root, 'prompt-disclosure-toggle').props.onPress(); });
  }
  return root.findAll(node => typeof node.type === 'string' && node.props?.testID === 'routine-prompt-output')[0].children.join('');
}

describe('routine prompt builders', () => {
  test('planning stays conversational until the user requests final Kilo text', () => {
    const prompt = buildRoutinePlanningPrompt(CURRENT);
    expect(prompt).toContain('Start by discussing my goals');
    expect(prompt).toContain('until I explicitly ask');
    expect(prompt).toContain(CURRENT.raw_text);
    expect(prompt).toContain('Selected routine: Upper');
    expect(prompt).toContain('<<< BEGIN KILO ROUTINE REFERENCE:');
    expect(prompt).not.toContain('Current routine');
    expect(prompt).not.toContain('https://');
  });

  test('normalization includes authoritative and selected routines while preserving everything except names', () => {
    const prompt = buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [TARGET] });
    expect(prompt).toContain('Kilo routine text is plain text');
    expect(prompt).toContain(CURRENT.raw_text);
    expect(prompt).toContain(TARGET.raw_text);
    expect(prompt).toContain('Authoritative routine: Upper');
    expect(prompt).toContain('Label each result with its exact reference label');
    expect(prompt).toContain('Target routine 1: Upper');
    expect(prompt).toContain('Return every target, even when nothing changed');
    expect(prompt).toContain('do not add explanations, a summary, or a change list');
    expect(prompt).toContain('Do not use Markdown fences or return any reference markers');
    expect(prompt).not.toContain('Target routine 1: Upper\n---');
  });

  test('normalization states the six cleanup rules (#1383)', () => {
    const prompt = buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [TARGET] });
    for (const rule of [
      '1. Match conservatively.', 'merely related or similar, or the match is uncertain, leave that header exactly as it is', 'Do not invent exercises', 'never invent a cleaner name',
      '2. Use the authoritative name exactly.', 'character for character', 'Never copy the authoritative routine\'s prescription into the target',
      '3. Preserve the target prescription exactly.', 'same numbers, rep ranges, spelling, and spacing', 'The prescription is not descriptor text',
      '4. Move all remaining descriptor text to one "-- " note.', 'Do not decide that phrases such as "each leg", "light", or "step up" are redundant',
      'Keep the descriptor\'s wording, capitalization, and internal punctuation exactly', 'you may remove only the separator before it', 'Do not paraphrase, summarize, or delete any of its words',
      '5. Place that note directly after the exercise\'s logged sets, or directly after its header when it has no sets', 'bare rows without a dash', 'skipped rows', 'Leave existing comments where they are', 'never move the note past the next exercise, day heading, section marker, or Week A/B divider',
      '6. Preserve everything else.', 'session and history columns', 'exercise order', 'must be returned completely unchanged',
    ]) expect(prompt).toContain(rule);
    expect(prompt).not.toMatch(/byte|verbatim/i);
  });

  test('normalization includes the four before/after examples without overriding the authority', () => {
    const prompt = buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [TARGET] });
    for (const example of [
      'Authority "Single-Leg RDL": header "-Single-Leg RDL 2x8 each leg, light" becomes "-Single-Leg RDL 2x8", with the note "-- each leg, light".',
      'Authority "DB Bench Press": header "-DB Bench Press 3x6-8, step up" becomes "-DB Bench Press 3x6-8", with the note "-- step up".',
      'Authority "Lat Pulldown": header "-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)" becomes "-Lat Pulldown 2x10-12", with the note "-- pack shoulder down on eccentric".',
      'Authority "Deadlift": header "-Deadlift — trial sets, slow and controlled" becomes "-Deadlift", with the note "-- trial sets, slow and controlled".',
      '-DB Bench Press 3x6-8\n85 8,8,8\n90 -\n-- step up\n-- felt good',
    ]) expect(prompt).toContain(example);
    expect(prompt).toContain('always use the names in the authoritative routine below');
  });

  test('planning and format prompts keep their existing text', () => {
    expect(ROUTINE_PROMPT_FORMAT_GUIDE).toBe(`Kilo routine text is plain text. Use a day heading followed by exercise headers and optional logged sets:

Monday
-Bench Press 3x5-8
- 135 5,5,5
-- Keep shoulders pinned

Wednesday
-Squat 3x5
- 185 5,5,5

Use a standalone --- line only to divide Week A from Week B. Keep comments on lines beginning with --. Exercise headers begin with one dash; logged sets begin with a dash and a space. Do not add Markdown fences, explanations, or metadata to final importable routine text.`);
    expect(buildRoutinePlanningPrompt(CURRENT)).toBe(`I want to plan or update this Kilo workout routine. Start by discussing my goals, constraints, recovery, exercise preferences, and proposed changes. Ask useful questions before writing a replacement routine. Do not produce final importable routine text until I explicitly ask for it.

When I ask for the final version, return only the complete Kilo-importable routine text, with no Markdown fence, explanation, or reference markers. ${ROUTINE_PROMPT_FORMAT_GUIDE}\n\n<<< BEGIN KILO ROUTINE REFERENCE: Selected routine: Upper >>>\n${CURRENT.raw_text}\n<<< END KILO ROUTINE REFERENCE >>>`);
    expect(buildKiloRoutineFormatPrompt()).toBe(`Help me create a routine that I can paste into Kilo's Import Routine screen. ${ROUTINE_PROMPT_FORMAT_GUIDE}

First ask about my training goals, schedule, experience, equipment, and preferences. When I ask for the final routine, return only Kilo-importable routine text.`);
  });

  test('normalization prompt text is byte-identical to the #1383 protocol (#1385)', () => {
    const expected = [
      "Use the authoritative routine below as the source of truth for exercise names. Apply these rules to every selected target routine:",
      "",
      "1. Match conservatively. Treat a target exercise as a match only when you are highly confident it is the same movement as one authoritative exercise, even if it is written with shorthand, a spelling or punctuation difference, a different prescription, or extra descriptor text. If the exercises are merely related or similar, or the match is uncertain, leave that header exactly as it is. Do not invent exercises, and do not use any routine other than the authoritative routine as the source of names. If an authoritative name itself looks ambiguous or untidy, use it as written or leave the target unchanged; never invent a cleaner name.",
      "2. Use the authoritative name exactly. For a confident match, replace the target header's name with the authoritative exercise name, character for character, keeping the target header's own structure (its leading dash or number and any marks such as *). Never copy the authoritative routine's prescription into the target.",
      "3. Preserve the target prescription exactly. Keep the target's own sets-by-reps prescription (such as 2x8 or 3x6-8) in the header with the same numbers, rep ranges, spelling, and spacing. The prescription is not descriptor text and must not move.",
      "4. Move all remaining descriptor text to one \"-- \" note. Any other text in the target header beyond the name and prescription (cues, qualifiers, intensity, side notes) goes into a single comment line that starts with \"-- \" (two dashes and a space). Do not decide that phrases such as \"each leg\", \"light\", or \"step up\" are redundant and drop them. Keep the descriptor's wording, capitalization, and internal punctuation exactly; you may remove only the separator before it (such as a comma or dash) and parentheses that enclose all of it. Do not paraphrase, summarize, or delete any of its words.",
      "5. Place that note directly after the exercise's logged sets, or directly after its header when it has no sets. Logged sets include rows with a leading \"- \" (for example \"- 135 5,5,5\"), bare rows without a dash (for example \"135 5,5,5\"), and skipped rows (for example \"135 -\"). Leave existing comments where they are, and never move the note past the next exercise, day heading, section marker, or Week A/B divider.",
      "6. Preserve everything else. Keep weights, reps, session and history columns, dates, existing comments, day headings, section markers (such as +WARMUP), Week A/B \"---\" dividers, structural marks, exercise order, and all unrelated whitespace and text exactly as written. Do not add, remove, reorder, or otherwise edit exercises or sets. A target with no confident match must be returned completely unchanged.",
      "",
      "Examples (the authoritative names here only illustrate the transformation; always use the names in the authoritative routine below):",
      "- Authority \"Single-Leg RDL\": header \"-Single-Leg RDL 2x8 each leg, light\" becomes \"-Single-Leg RDL 2x8\", with the note \"-- each leg, light\".",
      "- Authority \"DB Bench Press\": header \"-DB Bench Press 3x6-8, step up\" becomes \"-DB Bench Press 3x6-8\", with the note \"-- step up\".",
      "- Authority \"Lat Pulldown\": header \"-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)\" becomes \"-Lat Pulldown 2x10-12\", with the note \"-- pack shoulder down on eccentric\".",
      "- Authority \"Deadlift\": header \"-Deadlift — trial sets, slow and controlled\" becomes \"-Deadlift\", with the note \"-- trial sets, slow and controlled\".",
      "",
      "For example, this target exercise:",
      "-DB Bench Press 3x6-8, step up",
      "85 8,8,8",
      "90 -",
      "-- felt good",
      "",
      "is returned as:",
      "-DB Bench Press 3x6-8",
      "85 8,8,8",
      "90 -",
      "-- step up",
      "-- felt good",
      "",
      "Return each selected target as complete Kilo-importable routine text, one at a time. Label each result with its exact reference label, for example \"Target routine 1: Upper\", on its own line directly before that routine's text, so duplicate routine titles remain distinguishable. Return every target, even when nothing changed, and do not add explanations, a summary, or a change list. Do not use Markdown fences or return any reference markers. Kilo routine text is plain text. Use a day heading followed by exercise headers and optional logged sets:",
      "",
      "Monday",
      "-Bench Press 3x5-8",
      "- 135 5,5,5",
      "-- Keep shoulders pinned",
      "",
      "Wednesday",
      "-Squat 3x5",
      "- 185 5,5,5",
      "",
      "Use a standalone --- line only to divide Week A from Week B. Keep comments on lines beginning with --. Exercise headers begin with one dash; logged sets begin with a dash and a space. Do not add Markdown fences, explanations, or metadata to final importable routine text.",
      "",
      "<<< BEGIN KILO ROUTINE REFERENCE: Authoritative routine: Upper >>>",
      "Monday",
      "-Bench Press",
      "- 135 5 *PR",
      "-- keep tight",
      "---",
      "Tuesday",
      "-Squat",
      "- 185 -",
      "<<< END KILO ROUTINE REFERENCE >>>",
      "",
      "<<< BEGIN KILO ROUTINE REFERENCE: Target routine 1: Upper >>>",
      "Monday",
      "-Bench press",
      "- 135 5 *PR",
      "-- keep tight",
      "---",
      "Tuesday",
      "-Squat",
      "- 185 -",
      "<<< END KILO ROUTINE REFERENCE >>>",
    ].join('\n');
    expect(buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [TARGET] })).toBe(expected);
  });

  test('builders keep malformed and long local note text verbatim', () => {
    const malformed = { id: 'odd', title: 'Odd', raw_text: `Monday\n-Not quite valid\n- ???\n${'x'.repeat(12_000)}` };
    expect(buildRoutinePlanningPrompt(malformed)).toContain(malformed.raw_text);
    expect(buildExerciseNameNormalizationPrompt({ authority: malformed, targets: [CURRENT] })).toContain(malformed.raw_text);
  });

  test('the generic format template contains no routine data', () => {
    const prompt = buildKiloRoutineFormatPrompt();
    expect(prompt).toContain('Kilo routine text is plain text');
    expect(prompt).not.toContain('Upper');
    expect(prompt).not.toContain('https://');
  });
});

// Test double for the storage batch: authority check against `loadNotes`,
// then a per-item `saveOne` (resolves a status or throws = failed).
function batchFrom(saveOne, loadNotes) {
  return jest.fn(async ({ authority, items }) => {
    const current = (await loadNotes()).find(note => note.id === authority.id);
    if (!current || ![authority.expected_raw_text, ...authority.accepted_raw_texts].includes(current.raw_text)) {
      return { authority: current ? 'stale' : 'missing', saved: [], skipped: [], failed: [] };
    }
    const result = { authority: 'unchanged', saved: [], skipped: [], failed: [] };
    for (const item of items) {
      try {
        const status = await saveOne(item.id, item.expected_raw_text, item.next_raw_text);
        (status === 'saved' ? result.saved : result.skipped).push({ id: item.id, status, pending_sync: false });
      } catch {
        result.failed.push({ id: item.id, pending_sync: true });
      }
    }
    return result;
  });
}

describe('RoutinePromptToolsScreen', () => {
  const mount = ({ saveText, ...props } = {}) => {
    const loadNotes = props.loadNotes || (async () => [CURRENT, TARGET]);
    if (saveText) props.applyBatch = batchFrom(saveText, loadNotes);
    let tree;
    act(() => {
      tree = render.create(<RoutinePromptToolsScreen
        onBack={() => {}}
        loadNotes={async () => [CURRENT, TARGET]}
        loadCurrentId={async () => 'current'}
        copy={jest.fn().mockResolvedValue()}
        share={jest.fn().mockResolvedValue()}
        {...props}
      />);
    });
    return tree;
  };

  test('uses Current as the initial authority and copies only after explicit action', async () => {
    const copy = jest.fn().mockResolvedValue();
    const share = jest.fn().mockResolvedValue();
    const tree = mount({ copy, share });
    await act(async () => {});
    await act(async () => { button(tree.root, 'Plan or update routine').props.onPress(); });
    expect(promptOutput(tree.root)).toContain('Bench Press');
    await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0][0]).toContain(CURRENT.raw_text);
    await act(async () => { button(tree.root, 'Share prompt').props.onPress(); });
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining(CURRENT.raw_text) });
  });

  test('allows any authority and explicit targets, including duplicate titles', async () => {
    const tree = mount();
    await act(async () => {});
    await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
    await choose(tree, 'authority', ['target']);
    await choose(tree, 'targets', ['current']);
    const output = promptOutput(tree.root);
    expect(output).toContain(TARGET.raw_text);
    expect(output).toContain(CURRENT.raw_text);
  });

  test('handles an empty library and never generates a routine-specific prompt', async () => {
    const tree = mount({ loadNotes: async () => [], loadCurrentId: async () => null });
    await act(async () => {});
    await act(async () => { button(tree.root, 'Plan or update routine').props.onPress(); });
    expect(tree.root.findAll(node => node.props?.testID === 'routine-prompt-output')).toHaveLength(0);
    expect(tree.root.findAllByType('Text').some(node => node.children.join('').includes('Create a routine first'))).toBe(true);
  });

  describe('shared compact flow (#1385)', () => {
    const DATED = [
      { ...CURRENT, updated_at: '2026-10-15T08:00:00.000Z' },
      { ...TARGET, updated_at: '2026-09-01T08:00:00.000Z' },
    ];
    // A captured snapshot persists; keep it from leaking into later tests.
    afterEach(async () => { await AsyncStorage.clear(); });
    const open = async (tree, label) => {
      await act(async () => {});
      await act(async () => { button(tree.root, label).props.onPress(); });
    };
    const texts = root => root.findAllByType('Text').map(node => node.children.join('')).join('\n');
    const visibleSheets = root => root.findAllByType(Modal).filter(node => node.props.visible);
    const doneButton = root => root.findAll(node => /^Done choosing/.test(node.props?.accessibilityLabel || '') && typeof node.props.onPress === 'function')[0];

    test('every tool mounts the same flow, actions and disclosure; pickers only where needed', async () => {
      const expected = { 'Plan or update routine': 1, 'Normalize exercise names': 2, 'Kilo routine format': 0 };
      for (const [label, pickers] of Object.entries(expected)) {
        const tree = mount();
        await open(tree, label);
        expect(tree.root.findAllByType(PromptFlow)).toHaveLength(1);
        expect(tree.root.findAllByType(RoutinePicker)).toHaveLength(pickers);
        if (pickers < 2) {
          expect(tree.root.findAllByType(PromptDisclosureToggle)).toHaveLength(1);
          expect(button(tree.root, 'Copy prompt')).toBeTruthy();
          expect(button(tree.root, 'Share prompt')).toBeTruthy();
        }
        expect(button(tree.root, 'Generate prompt')).toBeUndefined();
      }
    });

    test('Format works with no routine data and shows its summary', async () => {
      const tree = mount({ loadNotes: async () => { throw new Error('read failed'); } });
      await open(tree, 'Kilo routine format');
      expect(texts(tree.root)).toContain('No routine data');
      expect(promptOutput(tree.root)).toBe(buildKiloRoutineFormatPrompt());
    });

    test('Plan sends the full routine with logged history, byte-identical to the builder', async () => {
      const tree = mount({ loadNotes: async () => DATED });
      await open(tree, 'Plan or update routine');
      expect(promptOutput(tree.root)).toBe(buildRoutinePlanningPrompt(DATED[0]));
      expect(promptOutput(tree.root)).toContain('- 135 5 *PR');
      expect(texts(tree.root)).toContain('Plan: Upper');
      expect(button(tree.root, 'Review normalized routines')).toBeUndefined();
    });

    test('the routine sheet opens, selects by id and Done closes back to the summary', async () => {
      const tree = mount({ loadNotes: async () => DATED });
      await open(tree, 'Plan or update routine');
      expect(visibleSheets(tree.root)).toHaveLength(0);
      await act(async () => { byTestId(tree.root, 'routine-picker-authority').props.onPress(); });
      expect(visibleSheets(tree.root)).toHaveLength(1);
      await act(async () => { byTestId(tree.root, 'routine-picker-authority-option-target').props.onPress(); });
      await act(async () => { doneButton(tree.root).props.onPress(); });
      expect(visibleSheets(tree.root)).toHaveLength(0);
      expect(promptOutput(tree.root)).toBe(buildRoutinePlanningPrompt(DATED[1]));
    });

    test('duplicate titles are told apart by detail lines, with truthful fallbacks', async () => {
      const odd = { id: 'odd', title: 'Upper', raw_text: 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1) };
      const tree = mount({ loadNotes: async () => [DATED[0], DATED[1], odd, { id: 'blank', title: '', raw_text: '' }] });
      await open(tree, 'Plan or update routine');
      await act(async () => { byTestId(tree.root, 'routine-picker-authority').props.onPress(); });
      const label = id => byTestId(tree.root, `routine-picker-authority-option-${id}`).props.accessibilityLabel;
      expect(label('current')).toBe('Upper, Current · edited 10-15-2026 · 2 exercises');
      expect(label('target')).toBe('Upper, edited 09-01-2026 · 2 exercises');
      expect(label('odd')).toBe('Upper, edit date unknown · exercises unavailable');
      expect(label('blank')).toBe('Untitled Routine, edit date unknown · no exercises');
      expect(texts(tree.root)).not.toContain('Upper (2)');
    });

    test('Targets start empty; Select all, All except authority and Clear act on ids', async () => {
      const tree = mount({ loadNotes: async () => DATED });
      await open(tree, 'Normalize exercise names');
      expect(texts(tree.root)).toContain('Choose routines');
      expect(button(tree.root, 'Copy prompt')).toBeUndefined();
      const press = async id => { await act(async () => { byTestId(tree.root, `routine-picker-targets-${id}`).props.onPress(); }); };
      await act(async () => { byTestId(tree.root, 'routine-picker-targets').props.onPress(); });
      await press('all');
      expect(texts(tree.root)).toContain('2 routines selected');
      await press('clear');
      expect(texts(tree.root)).toContain('Choose routines');
      await press('except');
      expect(texts(tree.root)).toContain('1 routine selected');
      expect(byTestId(tree.root, 'routine-picker-targets-option-target').props.accessibilityState).toEqual({ checked: true });
      expect(byTestId(tree.root, 'routine-picker-targets-option-current').props.accessibilityState).toEqual({ checked: false });
    });

    test('changing the authority never selects or clears targets, and builds automatically', async () => {
      const tree = mount({ loadNotes: async () => DATED });
      await open(tree, 'Normalize exercise names');
      await choose(tree, 'authority', ['target']);
      expect(texts(tree.root)).toContain('Choose routines');
      expect(button(tree.root, 'Copy prompt')).toBeUndefined();
      await choose(tree, 'targets', ['current']);
      expect(button(tree.root, 'Copy prompt')).toBeTruthy();
      expect(texts(tree.root)).toContain('1 routine · 2 exercises');
      expect(promptOutput(tree.root)).toBe(buildExerciseNameNormalizationPrompt({ authority: DATED[1], targets: [DATED[0]] }));
      await choose(tree, 'authority', ['current']);
      expect(texts(tree.root)).toContain('1 routine selected');
    });

    test('the prompt is collapsed by default and toggles; expanding never captures a snapshot', async () => {
      const tree = mount({ canPickFile: false });
      await open(tree, 'Normalize exercise names');
      await choose(tree, 'targets', ['target']);
      const present = () => tree.root.findAll(node => node.props?.testID === 'routine-prompt-output').length > 0;
      expect(present()).toBe(false);
      expect(byTestId(tree.root, 'prompt-disclosure-toggle').props.accessibilityState).toEqual({ expanded: false });
      await act(async () => { byTestId(tree.root, 'prompt-disclosure-toggle').props.onPress(); });
      expect(present()).toBe(true);
      expect(byTestId(tree.root, 'prompt-disclosure-toggle').props.accessibilityState).toEqual({ expanded: true });
      expect(button(tree.root, 'Review normalized routines')).toBeUndefined();
      await act(async () => { byTestId(tree.root, 'prompt-disclosure-toggle').props.onPress(); });
      expect(present()).toBe(false);
    });

    test('Copy/Share and import actions precede the expanded prompt, and toggling keeps Retry state', async () => {
      const saveText = jest.fn().mockRejectedValueOnce(new Error('enqueue failed')).mockResolvedValue('saved');
      const tree = mount({ saveText, canPickFile: false });
      await open(tree, 'Normalize exercise names');
      await choose(tree, 'targets', ['target']);
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      const input = tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
      await act(async () => { input.props.onChangeText('Target routine 1: Upper\n' + TARGET.raw_text.replace('-Bench press', '-Bench Press')); });
      await act(async () => { button(tree.root, 'Review normalized routines').props.onPress(); });
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      await act(async () => { byTestId(tree.root, 'prompt-disclosure-toggle').props.onPress(); });
      const order = [];
      const visit = (node) => {
        if (typeof node.type === 'string') order.push(node.props?.accessibilityLabel || node.props?.testID);
        (node.children || []).forEach(child => typeof child !== 'string' && visit(child));
      };
      visit(tree.root);
      const at = label => order.indexOf(label);
      const body = at('routine-prompt-output');
      expect(body).toBeGreaterThan(-1);
      for (const label of ['Copy prompt', 'Share prompt', 'Normalized routines reply', 'Review normalized routines', 'Retry failed routines']) {
        expect(at(label)).toBeGreaterThan(-1);
        expect(at(label)).toBeLessThan(body);
      }
      // Nothing operational follows the expanded prompt text.
      expect(order.slice(body + 1).filter(Boolean)).toEqual([]);
      await act(async () => { byTestId(tree.root, 'prompt-disclosure-toggle').props.onPress(); });
      await act(async () => { byTestId(tree.root, 'prompt-disclosure-toggle').props.onPress(); });
      expect(button(tree.root, 'Retry failed routines')).toBeTruthy();
      expect(texts(tree.root)).toContain('Couldn’t save Target routine 1: Upper.');
    });
  });

  describe('import normalized routines (#1172)', () => {
    const REPLY = 'Here are the results.\n\nTarget routine 1: Upper\n' + TARGET.raw_text.replace('-Bench press', '-Bench Press');
    const text = root => root.findAllByType('Text').map(node => node.children.join('')).join('\n');
    const setup = async (props = {}) => {
      const tree = mount({ canPickFile: false, ...props });
      await act(async () => {});
      await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
      await choose(tree, 'targets', ['target']);
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      return tree;
    };
    const paste = async (tree, value) => {
      const input = tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
      await act(async () => { input.props.onChangeText(value); });
      await act(async () => { button(tree.root, 'Review normalized routines').props.onPress(); });
    };

    test('import is offered only after the prompt is copied, and nothing is written before Apply', async () => {
      const saveText = jest.fn().mockResolvedValue('saved');
      const tree = mount({ saveText, canPickFile: false });
      await act(async () => {});
      await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
      await choose(tree, 'targets', ['target']);
      expect(button(tree.root, 'Review normalized routines')).toBeUndefined();
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      await paste(tree, REPLY);
      expect(text(tree.root)).toContain('Bench press → Bench Press');
      expect(saveText).not.toHaveBeenCalled();
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(saveText).toHaveBeenCalledWith('target', TARGET.raw_text, TARGET.raw_text.replace('-Bench press', '-Bench Press'));
      expect(text(tree.root)).toContain('Updated Target routine 1: Upper.');
    });

    test('a target returned unchanged is shown as having no proposed change', async () => {
      const saveText = jest.fn().mockResolvedValue('saved');
      const tree = await setup({ saveText });
      await paste(tree, 'Target routine 1: Upper\n' + TARGET.raw_text);
      expect(text(tree.root)).toContain('No proposed change. This routine is returned unchanged.');
      expect(button(tree.root, 'Apply normalized names').props.disabled).toBe(true);
      expect(saveText).not.toHaveBeenCalled();
    });

    test('a failed save is reported and can be retried without re-writing saved notes', async () => {
      const saveText = jest.fn().mockRejectedValueOnce(new Error('enqueue failed')).mockResolvedValue('saved');
      const tree = await setup({ saveText });
      await paste(tree, REPLY);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(text(tree.root)).toContain('Couldn’t save Target routine 1: Upper.');
      expect(text(tree.root)).not.toContain('Updated');
      await act(async () => { button(tree.root, 'Retry failed routines').props.onPress(); });
      expect(saveText).toHaveBeenCalledTimes(2);
      expect(text(tree.root)).toContain('Updated Target routine 1: Upper.');
    });

    test('an authority edited after the prompt blocks every write', async () => {
      const notes = [CURRENT, TARGET];
      const saveText = jest.fn();
      const tree = await setup({ saveText, loadNotes: async () => notes });
      await paste(tree, REPLY);
      notes[0] = { ...CURRENT, raw_text: `${CURRENT.raw_text}\n- 200 1` };
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(saveText).not.toHaveBeenCalled();
      expect(text(tree.root)).toContain('Nothing was written');
    });

    test('a structurally edited result is listed as not applied', async () => {
      const saveText = jest.fn();
      const tree = await setup({ saveText });
      await paste(tree, REPLY.replace('135', '145'));
      expect(text(tree.root)).toContain('Not applied');
      expect(button(tree.root, 'Apply normalized names').props.disabled).toBe(true);
    });

    test('a new snapshot discards an earlier preview, and applied text feeds the next prompt', async () => {
      const notes = [CURRENT, TARGET];
      const saveText = jest.fn(async (id, _expected, next) => { notes[1] = { ...TARGET, raw_text: next }; return 'saved'; });
      const tree = await setup({ saveText, loadNotes: async () => notes });
      await paste(tree, REPLY);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      await act(async () => {});
      expect(promptOutput(tree.root)).not.toContain('-Bench press');
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      expect(tree.root.findAll(node => node.props?.accessibilityLabel === 'Apply normalized names')).toHaveLength(0);
      expect(text(tree.root)).not.toContain('Updated Target routine 1');
    });

    test('a failed post-apply re-read withholds the stale prompt', async () => {
      let calls = 0;
      const loadNotes = async () => { calls += 1; if (calls > 3) throw new Error('read failed'); return [CURRENT, TARGET]; };
      const tree = await setup({ loadNotes, saveText: jest.fn().mockResolvedValue('saved') });
      await paste(tree, REPLY);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      await act(async () => {});
      expect(tree.root.findAll(node => node.props?.testID === 'routine-prompt-output')).toHaveLength(0);
      expect(text(tree.root)).toContain('Couldn’t read routines');
    });

    test('an edit during an in-flight review discards that review', async () => {
      let release;
      let calls = 0;
      const loadNotes = () => { calls += 1; return calls === 2 ? new Promise(r => { release = () => r([CURRENT, TARGET]); }) : Promise.resolve([CURRENT, TARGET]); };
      const tree = await setup({ loadNotes });
      const input = () => tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
      await act(async () => { input().props.onChangeText(REPLY); });
      await act(async () => { button(tree.root, 'Review normalized routines').props.onPress(); });
      await act(async () => { input().props.onChangeText('different'); });
      await act(async () => { release(); });
      expect(tree.root.findAll(node => node.props?.accessibilityLabel === 'Apply normalized names')).toHaveLength(0);
    });

    test('prompt actions are withheld while notes refresh after apply', async () => {
      let calls = 0;
      let release;
      const loadNotes = () => { calls += 1; return calls === 4 ? new Promise(r => { release = () => r([CURRENT, TARGET]); }) : Promise.resolve([CURRENT, TARGET]); };
      const tree = await setup({ loadNotes, saveText: jest.fn().mockResolvedValue('saved') });
      await paste(tree, REPLY);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(button(tree.root, 'Copy prompt')).toBeUndefined();
      await act(async () => { release(); });
      expect(button(tree.root, 'Copy prompt')).toBeTruthy();
    });

    test('retry still works when the authority is also a saved target', async () => {
      const notes = [CURRENT, TARGET];
      const saveText = jest.fn(async (id, _e, next) => {
        if (id === 'target') throw new Error('enqueue failed');
        notes[0] = { ...notes[0], raw_text: next };
        return 'saved';
      });
      const tree = mount({ canPickFile: false, saveText, loadNotes: async () => notes });
      await act(async () => {});
      await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
      await choose(tree, 'targets', ['current', 'target']);
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      const reply = `Target routine 1\n${CURRENT.raw_text.replace('-Squat', '-Back Squat')}\nTarget routine 2\n${TARGET.raw_text.replace('-Bench press', '-Bench Press')}`;
      await paste(tree, reply);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(text(tree.root)).toContain('Couldn’t save Target routine 2');
      saveText.mockImplementation(async () => 'saved');
      await act(async () => { button(tree.root, 'Retry failed routines').props.onPress(); });
      expect(text(tree.root)).toContain('Updated Target routine 2: Upper.');
    });

    test('retry works when the authority landed locally but its enqueue failed', async () => {
      const notes = [CURRENT, TARGET];
      let first = true;
      const saveText = jest.fn(async (id, _e, next) => {
        if (id !== 'current') return 'saved';
        notes[0] = { ...notes[0], raw_text: next };
        if (first) { first = false; throw new Error('enqueue failed'); }
        return 'saved';
      });
      const tree = mount({ canPickFile: false, saveText, loadNotes: async () => notes });
      await act(async () => {});
      await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
      await choose(tree, 'targets', ['current']);
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      await paste(tree, `Target routine 1\n${CURRENT.raw_text.replace('-Squat', '-Back Squat')}`);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      await act(async () => { button(tree.root, 'Retry failed routines').props.onPress(); });
      expect(text(tree.root)).toContain('Updated Target routine 1: Upper.');
    });

    test('an all-failed apply keeps Retry reachable instead of accepting a new prompt', async () => {
      const copy = jest.fn().mockResolvedValue();
      const saveText = jest.fn().mockRejectedValueOnce(new Error('enqueue failed')).mockResolvedValue('saved');
      const tree = await setup({ saveText, copy });
      await paste(tree, REPLY);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      expect(copy).toHaveBeenCalledTimes(1);
      expect(text(tree.root)).toContain('Retry or resolve');
      const input = tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
      await act(async () => { input.props.onChangeText('edited'); });
      expect(button(tree.root, 'Review normalized routines').props.disabled).toBe(true);
      await act(async () => { button(tree.root, 'Retry failed routines').props.onPress(); });
      await act(async () => {});
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      expect(copy).toHaveBeenCalledTimes(2);
    });

    test('several targets are applied in one storage batch', async () => {
      const applyBatch = jest.fn(async ({ items }) => ({ authority: 'unchanged', saved: items.map(i => ({ id: i.id, pending_sync: false })), skipped: [], failed: [] }));
      const tree = mount({ canPickFile: false, applyBatch });
      await act(async () => {});
      await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
      await choose(tree, 'targets', ['current', 'target']);
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      await paste(tree, `Target routine 1\n${CURRENT.raw_text.replace('-Squat', '-Back Squat')}\nTarget routine 2\n${TARGET.raw_text.replace('-Bench press', '-Bench Press')}`);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(applyBatch).toHaveBeenCalledTimes(1);
      expect(applyBatch.mock.calls[0][0]).toEqual(expect.objectContaining({
        authority: expect.objectContaining({ id: 'current', expected_raw_text: CURRENT.raw_text }),
        items: [expect.objectContaining({ id: 'current' }), expect.objectContaining({ id: 'target' })],
      }));
      expect(text(tree.root)).toContain('Updated Target routine 1: Upper.');
      expect(text(tree.root)).toContain('Updated Target routine 2: Upper.');
    });

    test('an oversized paste is rejected before it is stored', async () => {
      const tree = await setup({ saveText: jest.fn() });
      const input = tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
      await act(async () => { input.props.onChangeText('x'.repeat(1024 * 1024 + 1)); });
      expect(input.props.value).toBe('');
      expect(text(tree.root)).toContain('too large');
    });

    test('Back is refused while failed saves await Retry', async () => {
      const saveText = jest.fn().mockRejectedValue(new Error('enqueue failed'));
      const tree = await setup({ saveText });
      await paste(tree, REPLY);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      const shell = tree.root.findAll(node => typeof node.props?.onBack === 'function' && node.props?.title === 'Prompt tools')[0];
      await act(async () => { shell.props.onBack(); });
      expect(button(tree.root, 'Retry failed routines')).toBeTruthy();
      expect(text(tree.root)).toContain('before leaving');
    });

    test('a landed-but-unqueued failure still refreshes routines', async () => {
      const loadNotes = jest.fn(async () => [CURRENT, TARGET]);
      const applyBatch = jest.fn(async ({ items }) => ({ authority: 'unchanged', saved: [], skipped: [], failed: items.map(i => ({ id: i.id, landed: true, pending_sync: false })) }));
      const tree = await setup({ loadNotes, applyBatch });
      await paste(tree, REPLY);
      const before = loadNotes.mock.calls.length;
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      await act(async () => {});
      expect(loadNotes.mock.calls.length).toBeGreaterThan(before);
    });

    describe('descriptor cleanup through the real local store (#1383)', () => {
      const AUTH = { id: 'current', title: 'Upper', raw_text: 'Monday\n-DB Bench Press 3x6-8\n-Deadlift' };
      const ORIG = 'Monday\n-DB Bench Press 3x6-8, step up\n85 8,8,8\n90 -\n-- felt good\n-Deadlift — trial sets, slow and controlled\n';
      const OUT = 'Monday\n-DB Bench Press 3x6-8\n85 8,8,8\n90 -\n-- step up\n-- felt good\n-Deadlift\n-- trial sets, slow and controlled';
      const TGT = { id: 'target', title: 'Upper', raw_text: ORIG };
      const TWIN = { id: 'twin', title: 'Upper', raw_text: 'Monday\n-Deadlift — trial sets, slow and controlled\n135 5' };
      const TWIN_OUT = 'Monday\n-Deadlift\n135 5\n-- trial sets, slow and controlled';
      const stored = async id => (await Storage.loadWorkoutNotes()).find(n => n.id === id).raw_text;
      const start = async extra => {
        await Storage.replaceWorkoutNotesRaw([]);
        for (const note of [AUTH, TGT, TWIN]) await Storage.saveWorkoutNoteItem(note);
        const tree = mount({ canPickFile: false, loadNotes: Storage.loadWorkoutNotes, ...extra });
        await act(async () => {});
        await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
        await choose(tree, 'targets', ['target', 'twin']);
        await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
        return tree;
      };

      test('Copy → Import → Review → Apply persists the cleaned text', async () => {
        const applyBatch = jest.fn(request => applyWorkoutNoteTextBatchIfUnchanged(request));
        const tree = await start({ applyBatch });
        await paste(tree, `Target routine 2: Upper\n${TWIN_OUT}\nTarget routine 1: Upper\n${OUT}`);
        expect(text(tree.root)).toContain('DB Bench Press 3x6-8, step up → DB Bench Press');
        await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
        expect(applyBatch.mock.calls[0][0].items).toEqual([
          { id: 'target', expected_raw_text: ORIG, next_raw_text: `${OUT}\n` },
          { id: 'twin', expected_raw_text: TWIN.raw_text, next_raw_text: TWIN_OUT },
        ]);
        expect(await stored('target')).toBe(`${OUT}\n`);
        expect(await stored('twin')).toBe(TWIN_OUT);
      });

      test('a reply that drops a descriptor is shown as not applied and writes nothing', async () => {
        const applyBatch = jest.fn(request => applyWorkoutNoteTextBatchIfUnchanged(request));
        const tree = await start({ applyBatch });
        await paste(tree, `Target routine 1\n${OUT.replace('-- step up\n', '')}\nTarget routine 2\n${TWIN.raw_text}`);
        expect(text(tree.root)).toContain('Not applied');
        expect(text(tree.root)).toContain('dropped header text');
        expect(button(tree.root, 'Apply normalized names').props.disabled).toBe(true);
        expect(applyBatch).not.toHaveBeenCalled();
        expect(await stored('target')).toBe(ORIG);
      });

      test('mixed outcome retries only the failed target, never duplicating its note', async () => {
        let failTwin = true;
        const saveOne = jest.fn(async (id, expected, next) => {
          if (id === 'twin' && failTwin) { failTwin = false; throw new Error('enqueue failed'); }
          return compareAndSetWorkoutNoteText(id, expected, next);
        });
        const tree = await start({ saveText: saveOne });
        await paste(tree, `Target routine 1\n${OUT}\nTarget routine 2\n${TWIN_OUT}`);
        await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
        expect(text(tree.root)).toContain('Couldn’t save Target routine 2');
        expect(await stored('twin')).toBe(TWIN.raw_text);
        await act(async () => { button(tree.root, 'Retry failed routines').props.onPress(); });
        expect(saveOne.mock.calls.map(c => c[0])).toEqual(['target', 'twin', 'twin']);
        expect(await stored('target')).toBe(`${OUT}\n`);
        expect(await stored('twin')).toBe(TWIN_OUT);
      });
    });

    test('a picked text file uses the same review pipeline', async () => {
      const tree = await setup({ canPickFile: true, pickFile: jest.fn().mockResolvedValue(REPLY) });
      await act(async () => { button(tree.root, 'Choose normalized routines file').props.onPress(); });
      expect(text(tree.root)).toContain('Bench press → Bench Press');
    });
  });
});

