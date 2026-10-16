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

// Compact reply for [TARGET]: H1 is '-Bench press', H2 is '-Squat'.
const GOOD = 'H1 => Bench Press\nH2 => no match';
const FIXED = TARGET.raw_text.replace('-Bench press', '-Bench Press');
// An authority that is also a target and holds both Squat names.
const AUTHN = { id: 'current', title: 'Upper', raw_text: 'Monday\n-Bench Press\n- 135 5 *PR\n-Back Squat\n- 185 -\n-Squat\n- 100 5' };
const AUTHN_FIXED = AUTHN.raw_text.replace('-Squat\n', '-Back Squat\n');
// For targets [AUTHN, TARGET]: H1 Bench Press, H2 Back Squat, H3 Squat, H4 Bench press.
const AUTHN_REPLY = 'H1 => no match\nH2 => no match\nH3 => Back Squat\nH4 => Bench Press';

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

  // Unique history/set/date/comment data that must never reach a Normalize prompt.
  const SENTINEL_AUTH = { id: 'sa', title: 'AuthTitle-SENTINEL', raw_text: 'Monday 2026-07-04\n+LIFTING (~30 min)\n-Bench Press 3x5\n- 9991 5,5,5 *PR9992\n-- authority-comment-9993\n-Squat\n135 5 -\nTuesday\n-Row 3x8' };
  const SENTINEL_TARGET = { id: 'st', title: 'TargetTitle-SENTINEL', raw_text: 'Monday 2026-07-05\n-bench press 3x5, paused\n- 8881 5,5,5 *PR8882\n85 8,8\n-- target-comment-8883\n---\nTuesday\n-squat 3x5\n135 5\n' };
  const SENTINELS = [/9991/, /9992/, /9993/, /8881/, /8882/, /8883/, /SENTINEL/, /2026-07/, /30 min/, /135 5/, /- 135/, /85 8,8/, /Keep shoulders pinned/, /Wednesday/, /logged sets/i, /Row 3x8/];

  test('normalization sends only authority names and distinct target headers; no history, sets, dates, comments or titles', () => {
    const prompt = buildExerciseNameNormalizationPrompt({ authority: SENTINEL_AUTH, targets: [SENTINEL_TARGET] });
    for (const sentinel of SENTINELS) expect(prompt).not.toMatch(sentinel);
    expect(prompt).not.toContain('Kilo routine text is plain text');
    expect(prompt).not.toContain(ROUTINE_PROMPT_FORMAT_GUIDE);
    expect(prompt).not.toContain('<<< BEGIN KILO ROUTINE REFERENCE');
    expect(prompt).toContain('<<< BEGIN KILO AUTHORITATIVE EXERCISE NAMES >>>\nBench Press\nSquat\nRow\n<<< END KILO AUTHORITATIVE EXERCISE NAMES >>>');
    expect(prompt).toContain('<<< BEGIN KILO EXERCISE HEADERS >>>\nH1\nheader: -bench press 3x5, paused\nwhere: Week A · Monday\n\nH2\nheader: -squat 3x5\nwhere: Week B · Tuesday\n<<< END KILO EXERCISE HEADERS >>>');
  });

  test('distinct headers are listed once with stable refs and combined contexts; names escape the grammar', () => {
    const twin = { id: 'tw', title: 'Twin', raw_text: 'Wednesday\n+WARMUP\n-bench press 3x5, paused\n-Bench Press 3x5\n' };
    const auth = { id: 'a', title: 'A', raw_text: 'Monday\n-Bench Press 3x5\n-Farmer\\Carry 2x40' };
    const prompt = buildExerciseNameNormalizationPrompt({ authority: auth, targets: [SENTINEL_TARGET, twin] });
    expect(prompt).toContain('Bench Press\nFarmer\\\\Carry\n<<< END KILO AUTHORITATIVE EXERCISE NAMES >>>');
    expect(prompt).toContain('H1\nheader: -bench press 3x5, paused\nwhere: Week A · Monday; Wednesday · WARMUP\n\nH2\nheader: -squat 3x5\nwhere: Week B · Tuesday\n\nH3\nheader: -Bench Press 3x5\nwhere: Wednesday · WARMUP\n<<< END');
    expect(buildExerciseNameNormalizationPrompt({ authority: auth, targets: [SENTINEL_TARGET, twin] })).toBe(prompt);
  });

  test('authority names stop at the prescription: post-prescription text is a descriptor, never part of a name (#1394)', () => {
    const auth = { id: 'a', title: 'A', raw_text: 'Monday\n-Single-Leg RDL 2x8 each leg\n- 20 8,8\n-Squat 5/3/1 3x5 heavy\n-Row' };
    const target = { id: 't', title: 'T', raw_text: 'Monday\n-Single-Leg RDL 2x8 each leg, light\n25 8,8\n' };
    const prompt = buildExerciseNameNormalizationPrompt({ authority: auth, targets: [target] });
    expect(prompt).toContain('<<< BEGIN KILO AUTHORITATIVE EXERCISE NAMES >>>\nSingle-Leg RDL\nSquat 5/3/1\nRow\n<<< END KILO AUTHORITATIVE EXERCISE NAMES >>>');
    expect(prompt).toContain('H1\nheader: -Single-Leg RDL 2x8 each leg, light\n');
    expect(prompt).not.toMatch(/each leg\n<<< END KILO AUTHORITATIVE|20 8,8|25 8,8/);
  });

  test('normalization returns no prompt when nothing safe can be extracted, never a full-note fallback', () => {
    const huge = { id: 'h', title: 'Huge', raw_text: `Monday\n-Bench\n${'x'.repeat(MAX_RAW_TEXT_LENGTH + 1)}` };
    expect(buildExerciseNameNormalizationPrompt({ authority: huge, targets: [TARGET] })).toBe('');
    expect(buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [huge] })).toBe('');
    expect(buildExerciseNameNormalizationPrompt({ authority: { raw_text: 'Monday' }, targets: [TARGET] })).toBe('');
    expect(buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [{ id: 'n', title: 'N', raw_text: 'Monday' }] })).toBe('');
    expect(buildExerciseNameNormalizationPrompt()).toBe('');
  });

  test('normalization states the cleanup rules (#1383) for header mappings', () => {
    const prompt = buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [TARGET] });
    for (const rule of [
      '1. Match conservatively.', 'merely related or similar, or the match is uncertain, reply "no match" for that header', 'Do not invent exercises', 'never invent a cleaner name',
      '2. Use the authoritative name exactly.', 'character for character', 'Never copy an authoritative prescription into a header',
      '3. The prescription stays in the header.', '(such as 2x8, 3x6-8, or 3x30 sec), any @load, and any marks stay exactly as they are',
      '4. Give all remaining descriptor text.', 'Do not decide that phrases such as "each leg", "light", or "step up" are redundant',
      'keeping its wording, capitalization, and internal punctuation exactly', 'you may remove only the separator before it', 'Do not paraphrase, summarize, or delete any of its words',
      'Kilo moves it into one "-- " note', 'reply "no match" for that header instead',
    ]) expect(prompt).toContain(rule);
    expect(prompt).not.toMatch(/byte|verbatim/i);
  });

  test('normalization documents the strict reply grammar and escapes', () => {
    const prompt = buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [TARGET] });
    for (const line of [
      'Reply with exactly one Markdown code block (three backticks before and after) and nothing outside it: no text before or after the block.',
      'Inside the block put exactly one line for every header, in any order, and nothing else.',
      '```text\nH3 => no match\nH3 => Lat Pulldown\nH3 => Lat Pulldown | pack shoulder down on eccentric\n```',
      '" => " (a space, an equals sign, a greater-than sign, a space)',
      '"no match" is literal lowercase text and leaves that header unchanged',
      'optionally followed by " | " (a space, a vertical bar, a space)',
      'never write " | " when there is no descriptor',
      'write each backslash as \\\\ and each vertical bar as \\| ; no other escapes exist',
      'Inside the block, do not add explanations, headings, blank lines, or leading or trailing spaces',
      'never return routine text',
    ]) expect(prompt).toContain(line);
    expect(prompt).not.toContain('Do not add Markdown fences');
  });

  test('Plan and Format prompts are byte-for-byte unchanged (#1389)', () => {
    const sha = value => require('crypto').createHash('sha256').update(value).digest('hex');
    expect(sha(buildRoutinePlanningPrompt({ title: 'Upper', raw_text: 'Monday\n-Bench Press\n- 135 5' }))).toBe('ef11ec3be6e89d7fd56de0f540f173500c0cdd7fff3101ce843dfd32d6b01ad6');
    expect(sha(buildKiloRoutineFormatPrompt())).toBe('49f0819f93f3929c78270f5452b3395ad2b651141a59d38c3b491778c9036a68');
  });

  test('normalization includes the four owner examples as header-to-reply lines without overriding the authority', () => {
    const prompt = buildExerciseNameNormalizationPrompt({ authority: CURRENT, targets: [TARGET] });
    for (const example of [
      'Authority "Single-Leg RDL": header "-Single-Leg RDL 2x8 each leg, light" is answered:\n```text\nH1 => Single-Leg RDL | each leg, light\n```',
      'Authority "DB Bench Press": header "-DB Bench Press 3x6-8, step up" is answered:\n```text\nH2 => DB Bench Press | step up\n```',
      'Authority "Lat Pulldown": header "-Lat Pulldown 2x10-12 (pack shoulder down on eccentric)" is answered:\n```text\nH3 => Lat Pulldown | pack shoulder down on eccentric\n```',
      'Authority "Deadlift": header "-Deadlift — trial sets, slow and controlled" is answered:\n```text\nH4 => Deadlift | trial sets, slow and controlled\n```',
    ]) expect(prompt).toContain(example);
    expect(prompt).toContain('always use the names in the authoritative list below');
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

  test('Plan keeps long and malformed local note text verbatim', () => {
    const malformed = { id: 'odd', title: 'Odd', raw_text: `Monday\n-Not quite valid\n- ???\n${'x'.repeat(12_000)}` };
    expect(buildRoutinePlanningPrompt(malformed)).toContain(malformed.raw_text);
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
    // The picked authority contributes names only; the picked target its headers.
    expect(output).toContain('<<< BEGIN KILO AUTHORITATIVE EXERCISE NAMES >>>\nBench press\nSquat\n<<< END');
    expect(output).toContain('header: -Bench Press\n');
    expect(output).not.toContain(TARGET.raw_text);
    expect(output).not.toContain(CURRENT.raw_text);
    expect(output).not.toContain('- 135 5 *PR');
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
      expect(texts(tree.root)).toContain('1 routine · 2 distinct headers');
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
      await act(async () => { input.props.onChangeText(GOOD); });
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
    const REPLY = GOOD;
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
      expect(text(tree.root)).toContain('-Bench press → Bench Press');
      expect(saveText).not.toHaveBeenCalled();
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(saveText).toHaveBeenCalledWith('target', TARGET.raw_text, FIXED);
      expect(text(tree.root)).toContain('Updated Target routine 1: Upper.');
    });

    test('a target returned unchanged is shown as having no proposed change', async () => {
      const saveText = jest.fn().mockResolvedValue('saved');
      const tree = await setup({ saveText });
      await paste(tree, 'H1 => no match\nH2 => no match');
      expect(text(tree.root)).toContain('No proposed change. This routine is left unchanged.');
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

    test('a malformed reply blocks Apply for the whole reply and is reported line by line', async () => {
      const saveText = jest.fn();
      const tree = await setup({ saveText });
      await paste(tree, `Sure! Here you go:\n${REPLY}\n\nH9 => no match`);
      expect(text(tree.root)).toContain('This reply can’t be applied, so nothing changed.');
      expect(text(tree.root)).toContain('Line 1 isn’t “H<number> => …”');
      expect(text(tree.root)).toContain('Line 4 isn’t “H<number> => …”');
      expect(text(tree.root)).toContain('H9 wasn’t in the prompt.');
      expect(button(tree.root, 'Apply normalized names')).toBeUndefined();
      expect(text(tree.root)).not.toContain('Name changes');
      await paste(tree, 'H1 => Bench Press');
      expect(text(tree.root)).toContain('H2 has no reply line.');
      expect(saveText).not.toHaveBeenCalled();
    });

    const fixUp = tree => button(tree.root, 'Copy fix-up message');
    const press = async (tree) => { await act(async () => { await fixUp(tree).props.onPress(); }); };

    test('a reply in one code block applies like an unfenced one; the tip sits by the paste box', async () => {
      const tree = await setup();
      expect(text(tree.root)).toContain('Tip: in ChatGPT or Claude, tap Copy on the code block, then paste here.');
      await paste(tree, `\n\`\`\`text\n${REPLY}\n\`\`\`\n`);
      expect(fixUp(tree)).toBeUndefined();
      expect(button(tree.root, 'Apply normalized names').props.disabled).toBe(false);
    });

    test('a reply that lost its line breaks shows one clear error and no cascade', async () => {
      const tree = await setup();
      await paste(tree, 'H1 => Bench Press H2 => no match');
      const shown = text(tree.root);
      expect(shown).toContain('The reply lost its line breaks');
      expect(shown).not.toContain('has no reply line');
      expect(shown).not.toContain('Line 1');
      expect(button(tree.root, 'Apply normalized names')).toBeUndefined();
    });

    test('the error panel is selectable and the fix-up button copies every problem, then confirms', async () => {
      const copy = jest.fn().mockResolvedValue();
      const tree = await setup({ copy });
      copy.mockClear();
      const bad = Array.from({ length: 22 }, (_, i) => `bad ${i}`).join('\n');
      await paste(tree, bad);
      const shown = text(tree.root);
      expect(shown).toContain('• Line 20 isn’t');
      expect(shown).not.toContain('Line 21 isn’t');
      expect(shown).toContain('+3 more');
      const selectable = tree.root.findAllByType('Text').filter(node => node.props.selectable);
      expect(selectable.length).toBeGreaterThanOrEqual(21);
      const control = tree.root.findAll(node => node.props?.accessibilityLabel === 'Copy fix-up message' && node.props.accessibilityRole === 'button');
      expect(control.length).toBeGreaterThan(0);
      expect(text(tree.root)).toContain('Copy fix-up message');
      expect(text(tree.root)).not.toContain('Fix-up message copied');
      await press(tree);
      const message = copy.mock.calls[0][0];
      expect(message.startsWith('Kilo couldn’t apply your reply. Fix these problems and send the full corrected reply again, in one code block, one line per header:\n- Line 1 isn’t')).toBe(true);
      expect(message).toContain('- Line 22 isn’t');
      expect(message).toContain('- H1–H2 have no reply line.');
      expect(message).not.toContain('more');
      expect(message.split('\n').length).toBe(1 + 23);
      expect(text(tree.root)).toContain('Fix-up message copied.');
    });

    test('a failed fix-up copy reports failure without a false success, and stale feedback resets', async () => {
      const copy = jest.fn().mockResolvedValue();
      const tree = await setup({ copy });
      await paste(tree, 'nope');
      copy.mockRejectedValueOnce(new Error('denied'));
      await press(tree);
      expect(text(tree.root)).toContain('Couldn’t copy the message.');
      expect(text(tree.root)).not.toContain('Fix-up message copied');
      await press(tree);
      expect(text(tree.root)).toContain('Fix-up message copied.');
      const input = tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
      await act(async () => { input.props.onChangeText('other'); });
      expect(fixUp(tree)).toBeUndefined();
      expect(text(tree.root)).not.toContain('Fix-up message copied');
      await paste(tree, 'other');
      expect(text(tree.root)).not.toContain('Fix-up message copied');
    });

    test('a fix-up copy that resolves after the reply changed shows no stale feedback', async () => {
      let release;
      const copy = jest.fn().mockResolvedValue();
      const tree = await setup({ copy });
      await paste(tree, 'nope');
      copy.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      let pending;
      await act(async () => { pending = fixUp(tree).props.onPress(); });
      await paste(tree, 'still bad');
      await act(async () => { release(); await pending; });
      expect(text(tree.root)).not.toContain('Fix-up message copied');
      expect(text(tree.root)).toContain('Line 1 isn’t');
    });

    // Superseding events must hide the old error list (and its Copy button)
    // at once, and late async completions must not publish over a newer reply.
    const deferred = () => { let resolve; let reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; };
    const replyInput = tree => tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
    // Returns the in-flight pick wrapped, so awaiting the helper never awaits the pick.
    const pick = async (tree) => { let pending; await act(async () => { pending = button(tree.root, 'Choose normalized routines file').props.onPress(); }); return { pending }; };

    test('a file review in flight hides the old problems, so they cannot be copied as the new reply’s', async () => {
      let hold = null;
      const loadNotes = () => (hold ? hold.promise : Promise.resolve([CURRENT, TARGET]));
      const copy = jest.fn().mockResolvedValue();
      const tree = await setup({ copy, loadNotes, canPickFile: true, pickFile: jest.fn().mockResolvedValue('second bad reply') });
      await paste(tree, 'first bad reply');
      expect(fixUp(tree)).toBeTruthy();
      hold = deferred();
      const { pending } = await pick(tree);
      expect(fixUp(tree)).toBeUndefined();
      expect(text(tree.root)).not.toContain('can’t be applied');
      await act(async () => { hold.resolve([CURRENT, TARGET]); await pending; });
      expect(fixUp(tree)).toBeTruthy();
      expect(text(tree.root)).not.toContain('Fix-up message copied');
      copy.mockClear();
      await press(tree);
      expect(copy).toHaveBeenCalledTimes(1);
      expect(text(tree.root)).toContain('Fix-up message copied.');
    });

    test('a pending, cancelled or failed file pick never leaves the old problems on screen', async () => {
      const picks = [deferred(), deferred()];
      const pickFile = jest.fn().mockReturnValueOnce(picks[0].promise).mockReturnValueOnce(picks[1].promise);
      const tree = await setup({ canPickFile: true, pickFile });
      await paste(tree, 'nope');
      let { pending } = await pick(tree);
      expect(fixUp(tree)).toBeUndefined();
      await act(async () => { picks[0].resolve(null); await pending; });
      expect(fixUp(tree)).toBeUndefined();
      expect(replyInput(tree).props.value).toBe('nope');
      await paste(tree, 'nope');
      ({ pending } = await pick(tree));
      expect(fixUp(tree)).toBeUndefined();
      await act(async () => { picks[1].reject(new Error('Couldn’t open that file.')); await pending; });
      expect(fixUp(tree)).toBeUndefined();
      expect(text(tree.root)).toContain('Couldn’t open that file.');
    });

    test('a file pick overtaken by an edit is dropped', async () => {
      const held = deferred();
      const tree = await setup({ canPickFile: true, pickFile: jest.fn().mockReturnValue(held.promise) });
      const { pending } = await pick(tree);
      await act(async () => { replyInput(tree).props.onChangeText('typed'); });
      await act(async () => { held.resolve(REPLY); await pending; });
      expect(replyInput(tree).props.value).toBe('typed');
      expect(button(tree.root, 'Apply normalized names')).toBeUndefined();
    });

    test('Review hides the shown problems until it finishes; copies from before it give no feedback', async () => {
      let hold = null;
      const loadNotes = () => (hold ? hold.promise : Promise.resolve([CURRENT, TARGET]));
      const clip = deferred();
      const copy = jest.fn().mockResolvedValue();
      const tree = await setup({ copy, loadNotes });
      await paste(tree, 'nope');
      copy.mockReturnValueOnce(clip.promise);
      let copying;
      await act(async () => { copying = fixUp(tree).props.onPress(); });
      hold = deferred();
      let reviewing;
      await act(async () => { reviewing = button(tree.root, 'Review normalized routines').props.onPress(); });
      expect(fixUp(tree)).toBeUndefined();
      await act(async () => { clip.resolve(); await copying; });
      await act(async () => { hold.resolve([CURRENT, TARGET]); await reviewing; });
      expect(fixUp(tree)).toBeTruthy();
      expect(text(tree.root)).not.toContain('Fix-up message copied');
    });

    test('only the newest fix-up copy reports its outcome', async () => {
      const first = deferred();
      const copy = jest.fn().mockResolvedValue();
      const tree = await setup({ copy });
      await paste(tree, 'nope');
      copy.mockReturnValueOnce(first.promise);
      let pending;
      await act(async () => { pending = fixUp(tree).props.onPress(); });
      await press(tree);
      await act(async () => { first.reject(new Error('denied')); await pending; });
      expect(text(tree.root)).toContain('Fix-up message copied.');
      expect(text(tree.root)).not.toContain('Couldn’t copy the message.');
    });

    test('discarding the saved prompt drops the shown problems and any review in flight', async () => {
      let hold = null;
      const loadNotes = () => (hold ? hold.promise : Promise.resolve([CURRENT, TARGET]));
      const remove = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValue(new Error('storage unavailable'));
      try {
        const tree = await setup({ loadNotes });
        await paste(tree, 'nope');
        hold = deferred();
        let reviewing;
        await act(async () => { reviewing = button(tree.root, 'Review normalized routines').props.onPress(); });
        await act(async () => { button(tree.root, 'Discard saved normalization prompt').props.onPress(); });
        await act(async () => { hold.resolve([CURRENT, TARGET]); await reviewing; });
        expect(text(tree.root)).toContain('Couldn’t discard the saved prompt.');
        expect(fixUp(tree)).toBeUndefined();
      } finally {
        remove.mockRestore();
      }
    });

    test('an apply in flight freezes the reply so its outcome cannot land beside another reply', async () => {
      const held = deferred();
      const tree = await setup({ applyBatch: jest.fn().mockReturnValue(held.promise) });
      await paste(tree, REPLY);
      let applying;
      await act(async () => { applying = button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(replyInput(tree).props.editable).toBe(false);
      expect(button(tree.root, 'Review normalized routines').props.disabled).toBe(true);
      await act(async () => { replyInput(tree).props.onChangeText('other'); });
      expect(replyInput(tree).props.value).toBe(REPLY);
      await act(async () => { held.resolve({ authority: 'unchanged', saved: [], skipped: [], failed: [] }); await applying; });
      expect(replyInput(tree).props.editable).toBe(true);
    });

    test('an invalid mapping is listed as not applied and never written; the Apply count ignores it', async () => {
      const saveText = jest.fn();
      const tree = await setup({ saveText });
      await paste(tree, 'H1 => Conventional Deadlift\nH2 => no match');
      expect(text(tree.root)).toContain('Not applied');
      expect(text(tree.root)).toContain('H1 “-Bench press” was left unchanged: “Conventional Deadlift” isn’t an exercise name in the authoritative routine.');
      expect(button(tree.root, 'Apply normalized names').props.disabled).toBe(true);
      expect(saveText).not.toHaveBeenCalled();
    });

    test('mapping, target and occurrence deselection all remove the rename together with its note', async () => {
      const applyBatch = jest.fn(async ({ items }) => ({ authority: 'unchanged', saved: items.map(i => ({ id: i.id, pending_sync: false })), skipped: [], failed: [] }));
      const tree = await setup({ applyBatch });
      await paste(tree, REPLY);
      const box = label => tree.root.findAll(node => node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
      const checked = label => box(label).props.accessibilityState.checked;
      expect(text(tree.root)).toContain('1 occurrence in 1 routine');
      for (const label of ['Rename -Bench press to Bench Press', 'Update Target routine 1: Upper', 'Update line 2 of Target routine 1: Upper']) {
        expect(checked(label)).toBe(true);
        await act(async () => { box(label).props.onPress(); });
        expect(checked(label)).toBe(false);
        expect(button(tree.root, 'Apply normalized names').props.disabled).toBe(true);
        await act(async () => { box(label).props.onPress(); });
        expect(button(tree.root, 'Apply normalized names').props.disabled).toBe(false);
      }
      expect(applyBatch).not.toHaveBeenCalled();
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
      const notes = [AUTHN, TARGET];
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
      await paste(tree, AUTHN_REPLY);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(text(tree.root)).toContain('Couldn’t save Target routine 2');
      saveText.mockImplementation(async () => 'saved');
      await act(async () => { button(tree.root, 'Retry failed routines').props.onPress(); });
      expect(text(tree.root)).toContain('Updated Target routine 2: Upper.');
    });

    test('retry works when the authority landed locally but its enqueue failed', async () => {
      const notes = [AUTHN, TARGET];
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
      await paste(tree, 'H1 => no match\nH2 => no match\nH3 => Back Squat');
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      await act(async () => { button(tree.root, 'Retry failed routines').props.onPress(); });
      expect(saveText).toHaveBeenCalledWith('current', AUTHN.raw_text, AUTHN_FIXED);
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
      const tree = mount({ canPickFile: false, applyBatch, loadNotes: async () => [AUTHN, TARGET] });
      await act(async () => {});
      await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
      await choose(tree, 'targets', ['current', 'target']);
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      await paste(tree, AUTHN_REPLY);
      await act(async () => { button(tree.root, 'Apply normalized names').props.onPress(); });
      expect(applyBatch).toHaveBeenCalledTimes(1);
      expect(applyBatch.mock.calls[0][0]).toEqual(expect.objectContaining({
        authority: expect.objectContaining({ id: 'current', expected_raw_text: AUTHN.raw_text }),
        items: [
          { id: 'current', expected_raw_text: AUTHN.raw_text, next_raw_text: AUTHN_FIXED },
          { id: 'target', expected_raw_text: TARGET.raw_text, next_raw_text: FIXED.replace('-Squat', '-Back Squat') },
        ],
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
      // For targets [TGT, TWIN]: H1 is the bench header, H2 the (shared) Deadlift header.
      const DESCRIPTOR_REPLY = 'H1 => DB Bench Press | step up\nH2 => Deadlift | trial sets, slow and controlled';
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
        await paste(tree, DESCRIPTOR_REPLY);
        expect(text(tree.root)).toContain('-DB Bench Press 3x6-8, step up → DB Bench Press');
        expect(text(tree.root)).toContain('Moves to a note: step up');
        expect(text(tree.root)).toContain('2 occurrences in 2 routines');
        await act(async () => { await button(tree.root, 'Apply normalized names').props.onPress(); });
        expect(applyBatch.mock.calls[0][0].items).toEqual([
          { id: 'target', expected_raw_text: ORIG, next_raw_text: `${OUT}\n` },
          { id: 'twin', expected_raw_text: TWIN.raw_text, next_raw_text: TWIN_OUT },
        ]);
        expect(await stored('target')).toBe(`${OUT}\n`);
        expect(await stored('twin')).toBe(TWIN_OUT);
      });

      // #1395: the screen's own apply carries Track in the same commit, and an
      // unreadable Track state is reported as a failed save with nothing written.
      test('the default apply carries Track to the canonical keys; unknown Track state saves nothing', async () => {
        const BENCH = 'db bench press 3x6-8, step up';
        const LIFT = 'deadlift — trial sets, slow and controlled';
        await Storage.saveTrackedLiftActivations({});
        await Storage.saveTrackedLifts({ [BENCH]: true, [LIFT]: true });
        const tree = await start({});
        await paste(tree, DESCRIPTOR_REPLY);
        await act(async () => { await button(tree.root, 'Apply normalized names').props.onPress(); });
        await act(async () => {});
        expect(text(tree.root)).toContain('Updated Target routine 1: Upper.');
        expect(await Storage.loadTrackedLifts()).toEqual({ 'db bench press': true, deadlift: true });
        act(() => tree.unmount());

        await AsyncStorage.setItem('kilo_tracked_lifts', '[broken');
        const second = await start({});
        await paste(second, DESCRIPTOR_REPLY);
        await act(async () => { await button(second.root, 'Apply normalized names').props.onPress(); });
        await act(async () => {});
        expect(text(second.root)).toContain('Couldn’t save Target routine 1: Upper.');
        expect(await stored('target')).toBe(ORIG);
        act(() => second.unmount());
        await Storage.saveTrackedLifts({});
      });

      test('a reply that drops a descriptor is shown as not applied and writes nothing for it', async () => {
        const applyBatch = jest.fn(request => applyWorkoutNoteTextBatchIfUnchanged(request));
        const tree = await start({ applyBatch });
        await paste(tree, 'H1 => DB Bench Press\nH2 => no match');
        expect(text(tree.root)).toContain('Not applied');
        expect(text(tree.root)).toContain('would be dropped without a descriptor');
        expect(button(tree.root, 'Apply normalized names').props.disabled).toBe(true);
        expect(applyBatch).not.toHaveBeenCalled();
        expect(await stored('target')).toBe(ORIG);
        // The independent valid mapping still applies; the rejected one never does.
        await paste(tree, 'H1 => DB Bench Press\nH2 => Deadlift | trial sets, slow and controlled');
        await act(async () => { await button(tree.root, 'Apply normalized names').props.onPress(); });
        expect(await stored('target')).toBe(ORIG.replace('-Deadlift — trial sets, slow and controlled\n', '-Deadlift\n-- trial sets, slow and controlled\n'));
        expect(await stored('twin')).toBe(TWIN_OUT);
      });

      test('a target or the authority edited between review and Apply is not written', async () => {
        const applyBatch = jest.fn(request => applyWorkoutNoteTextBatchIfUnchanged(request));
        const tree = await start({ applyBatch });
        await paste(tree, DESCRIPTOR_REPLY);
        await Storage.saveWorkoutNoteItem({ ...TWIN, raw_text: 'Monday\n-edited meanwhile' });
        await act(async () => { await button(tree.root, 'Apply normalized names').props.onPress(); });
        expect(text(tree.root)).toContain('Updated Target routine 1: Upper.');
        expect(text(tree.root)).toContain('Not updated Target routine 2: Upper: it was edited or removed after the prompt was generated.');
        expect(await stored('target')).toBe(`${OUT}\n`);
        expect(await stored('twin')).toBe('Monday\n-edited meanwhile');
      });

      test('an authority edited between review and Apply blocks every write', async () => {
        const applyBatch = jest.fn(request => applyWorkoutNoteTextBatchIfUnchanged(request));
        const tree = await start({ applyBatch });
        await paste(tree, DESCRIPTOR_REPLY);
        await Storage.saveWorkoutNoteItem({ ...AUTH, raw_text: `${AUTH.raw_text}\n-Row` });
        await act(async () => { await button(tree.root, 'Apply normalized names').props.onPress(); });
        expect(text(tree.root)).toContain('Nothing was written');
        expect(await stored('target')).toBe(ORIG);
        expect(await stored('twin')).toBe(TWIN.raw_text);
      });

      test('mixed outcome retries only the failed target, never duplicating its note', async () => {
        let failTwin = true;
        const saveOne = jest.fn(async (id, expected, next) => {
          if (id === 'twin' && failTwin) { failTwin = false; throw new Error('enqueue failed'); }
          return compareAndSetWorkoutNoteText(id, expected, next);
        });
        const tree = await start({ saveText: saveOne });
        await paste(tree, DESCRIPTOR_REPLY);
        await act(async () => { await button(tree.root, 'Apply normalized names').props.onPress(); });
        expect(text(tree.root)).toContain('Couldn’t save Target routine 2');
        expect(await stored('twin')).toBe(TWIN.raw_text);
        await act(async () => { await button(tree.root, 'Retry failed routines').props.onPress(); });
        expect(saveOne.mock.calls.map(c => c[0])).toEqual(['target', 'twin', 'twin']);
        expect(await stored('target')).toBe(`${OUT}\n`);
        expect(await stored('twin')).toBe(TWIN_OUT);
      });
    });

    test('a picked text file uses the same review pipeline', async () => {
      const tree = await setup({ canPickFile: true, pickFile: jest.fn().mockResolvedValue(REPLY) });
      await act(async () => { button(tree.root, 'Choose normalized routines file').props.onPress(); });
      expect(text(tree.root)).toContain('-Bench press → Bench Press');
    });

    test('an oversized picked file is rejected before it is stored, parsed or rendered', async () => {
      const tree = await setup({ canPickFile: true, pickFile: jest.fn().mockResolvedValue('x'.repeat(1024 * 1024 + 1)) });
      await act(async () => { button(tree.root, 'Choose normalized routines file').props.onPress(); });
      const input = tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
      expect(input.props.value).toBe('');
      expect(text(tree.root)).toContain('too large');
      expect(button(tree.root, 'Apply normalized names')).toBeUndefined();
    });
  });

  describe('compact snapshot lifecycle (#1386)', () => {
    beforeEach(async () => { await AsyncStorage.clear(); });
    afterEach(async () => { await AsyncStorage.clear(); });
    const text = root => root.findAllByType('Text').map(node => node.children.join('')).join('\n');
    const NOTES2 = [CURRENT, TARGET];
    const openNormalize = async (tree) => {
      await act(async () => {});
      await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
    };
    const copyFor = async (tree, ids) => {
      await choose(tree, 'targets', ids);
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
    };
    const paste = async (tree, value) => {
      const input = tree.root.findAll(node => node.props?.testID === 'normalization-reply-input' && node.props.onChangeText)[0];
      await act(async () => { input.props.onChangeText(value); });
      await act(async () => { button(tree.root, 'Review normalized routines').props.onPress(); });
    };
    const stored = async () => JSON.parse(await AsyncStorage.getItem('kilo_normalization_import_snapshot_v1'));

    test('capture happens only on explicit Copy and persists the protocol marker and catalog with the original texts', async () => {
      const tree = mount({ canPickFile: false });
      await openNormalize(tree);
      await choose(tree, 'targets', ['target']);
      expect(await stored()).toBeNull();
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      const snapshot = await stored();
      expect(snapshot).toEqual(expect.objectContaining({ protocol: 'compact-exercise-v1', version: 1 }));
      expect(snapshot.authority.raw_text).toBe(CURRENT.raw_text);
      expect(snapshot.targets).toEqual([{ id: 'target', title: 'Upper', raw_text: TARGET.raw_text }]);
      expect(snapshot.catalog).toEqual({
        names: ['Bench Press', 'Squat'],
        headers: [
          { ref: 'H1', raw: '-Bench press', occurrences: [{ noteId: 'target', line: 1 }] },
          { ref: 'H2', raw: '-Squat', occurrences: [{ noteId: 'target', line: 6 }] },
        ],
      });
    });

    test('a remount restores the same refs and original text; later edits never reassign refs', async () => {
      const saveText = jest.fn().mockResolvedValue('saved');
      const first = mount({ canPickFile: false, saveText });
      await openNormalize(first);
      await copyFor(first, ['target']);
      act(() => { first.unmount(); });
      // The routine library changed after the prompt: another routine now sorts first.
      const extra = { id: 'extra', title: 'Extra', raw_text: 'Monday\n-Curl 3x8\n-Row 3x8' };
      const second = mount({ canPickFile: false, saveText, loadNotes: async () => [extra, CURRENT, TARGET] });
      await openNormalize(second);
      await paste(second, GOOD);
      expect(text(second.root)).toContain('-Bench press → Bench Press');
      await act(async () => { button(second.root, 'Apply normalized names').props.onPress(); });
      expect(saveText).toHaveBeenCalledWith('target', TARGET.raw_text, FIXED);
    });

    test('a new successful capture gets a new identity and discards the previous preview', async () => {
      const tree = mount({ canPickFile: false, saveText: jest.fn().mockResolvedValue('saved') });
      await openNormalize(tree);
      await copyFor(tree, ['target']);
      await paste(tree, GOOD);
      expect(button(tree.root, 'Apply normalized names')).toBeTruthy();
      await act(async () => { button(tree.root, 'Copy prompt').props.onPress(); });
      expect((await stored()).version).toBe(2);
      expect(button(tree.root, 'Apply normalized names')).toBeUndefined();
    });

    describe('a saved full-note prompt from before the compact protocol', () => {
      const LEGACY = { version: 7, authority: { id: 'current', title: 'Upper', raw_text: CURRENT.raw_text }, targets: [{ id: 'target', title: 'Upper', raw_text: TARGET.raw_text }] };
      beforeEach(async () => { await AsyncStorage.setItem('kilo_normalization_import_snapshot_v1', JSON.stringify(LEGACY)); });

      test('asks for a fresh compact prompt, offers no reply import, and is not erased', async () => {
        const tree = mount({ canPickFile: false });
        await openNormalize(tree);
        expect(tree.root.findAll(node => node.props?.testID === 'normalization-legacy-section')).not.toHaveLength(0);
        expect(text(tree.root)).toContain('can’t be imported');
        expect(tree.root.findAll(node => node.props?.testID === 'normalization-reply-input')).toHaveLength(0);
        expect(button(tree.root, 'Review normalized routines')).toBeUndefined();
        expect(await stored()).toEqual(LEGACY);
      });

      test('explicit Discard removes it durably; a failed discard keeps it and says so', async () => {
        const remove = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('storage unavailable'));
        const tree = mount({ canPickFile: false });
        await openNormalize(tree);
        await act(async () => { button(tree.root, 'Discard saved normalization prompt').props.onPress(); });
        expect(text(tree.root)).toContain('Couldn’t discard the saved prompt. It is still available.');
        expect(button(tree.root, 'Discard saved normalization prompt')).toBeTruthy();
        expect(await stored()).toEqual(LEGACY);
        remove.mockRestore();
        await AsyncStorage.setItem('kilo_normalization_import_snapshot_v1', JSON.stringify(LEGACY));
        await act(async () => { button(tree.root, 'Discard saved normalization prompt').props.onPress(); });
        expect(tree.root.findAll(node => node.props?.testID === 'normalization-legacy-section')).toHaveLength(0);
        expect(text(tree.root)).toContain('No saved normalization prompt is available');
      });

      test('a fresh Copy replaces it with a compact snapshot and shows the compact import', async () => {
        const tree = mount({ canPickFile: false });
        await openNormalize(tree);
        await copyFor(tree, ['target']);
        expect(tree.root.findAll(node => node.props?.testID === 'normalization-legacy-section')).toHaveLength(0);
        expect((await stored()).protocol).toBe('compact-exercise-v1');
        expect((await stored()).version).toBe(8);
        expect(button(tree.root, 'Review normalized routines')).toBeTruthy();
      });
    });

    test('nothing safe to extract is a truthful blocked state with no prompt, no actions and no capture', async () => {
      const empty = { id: 'empty', title: 'Empty', raw_text: 'Monday' };
      const tree = mount({ canPickFile: false, loadNotes: async () => [CURRENT, TARGET, empty] });
      await openNormalize(tree);
      await choose(tree, 'targets', ['empty']);
      expect(text(tree.root)).toContain('The selected routines have no exercise headers to share.');
      expect(button(tree.root, 'Copy prompt')).toBeUndefined();
      expect(tree.root.findAll(node => node.props?.testID === 'routine-prompt-output')).toHaveLength(0);
      await choose(tree, 'authority', ['empty']);
      await choose(tree, 'targets', ['target']);
      expect(text(tree.root)).toContain('The authoritative routine has no exercise names to share.');
      expect(await stored()).toBeNull();
    });

    test('the summary counts routines and distinct headers (deduplicated by exact header text)', async () => {
      const tree = mount({ canPickFile: false, loadNotes: async () => [CURRENT, TARGET, { ...TARGET, id: 'twin' }] });
      await openNormalize(tree);
      await choose(tree, 'targets', ['target', 'twin']);
      expect(text(tree.root)).toContain('2 routines · 2 distinct headers');
    });
  });
});

