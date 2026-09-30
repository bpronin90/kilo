import React from 'react';
import render, { act } from 'react-test-renderer';
import {
  buildExerciseNameNormalizationPrompt,
  buildKiloRoutineFormatPrompt,
  buildRoutinePlanningPrompt,
} from '../lib/interoperability/routinePrompts';
import { RoutinePromptToolsScreen } from '../components/RoutinePromptToolsScreen';

const CURRENT = { id: 'current', title: 'Upper', raw_text: 'Monday\n-Bench Press\n- 135 5 *PR\n-- keep tight\n---\nTuesday\n-Squat\n- 185 -' };
const TARGET = { id: 'target', title: 'Upper', raw_text: 'Monday\n-Bench press\n- 135 5 *PR\n-- keep tight\n---\nTuesday\n-Squat\n- 185 -' };

function button(root, label) {
  return root.findAll(node => node.props?.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
}

function promptOutput(root) {
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
    expect(prompt).toContain('weights, reps, dates, weekdays, comments/notes, marks, skipped sets, and Week A/B boundaries');
    expect(prompt).toContain('with the authoritative name exactly; do not keep header suffixes or other descriptor text in the header');
    expect(prompt).toContain('move that text into a "-- " comment line (two dashes and a space) directly under that exercise\'s logged sets');
    expect(prompt).toContain('never becomes part of the exercise header');
    expect(prompt).toContain('only when you have a high-confidence match');
    expect(prompt).toContain('merely related or similar, leave that header exactly as it is');
    expect(prompt).toContain('only edit allowed is the name portion of a matching exercise header');
    expect(prompt).toContain('order, day headings, section markers');
    expect(prompt).toContain('must be returned completely unchanged');
    expect(prompt).toContain(CURRENT.raw_text);
    expect(prompt).toContain(TARGET.raw_text);
    expect(prompt).toContain('Label each result with its exact reference label');
    expect(prompt).toContain('Target routine 1: Upper');
    expect(prompt).not.toContain('Target routine 1: Upper\n---');
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
    const authority = button(tree.root, 'Use Upper (2) as the authoritative routine');
    expect(authority).toBeTruthy();
    await act(async () => { authority.props.onPress(); });
    await act(async () => { button(tree.root, 'Normalize Upper (1)').props.onPress(); });
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

  describe('import normalized routines (#1172)', () => {
    const REPLY = 'Here are the results.\n\nTarget routine 1: Upper\n' + TARGET.raw_text.replace('-Bench press', '-Bench Press');
    const text = root => root.findAllByType('Text').map(node => node.children.join('')).join('\n');
    const setup = async (props = {}) => {
      const tree = mount({ canPickFile: false, ...props });
      await act(async () => {});
      await act(async () => { button(tree.root, 'Normalize exercise names').props.onPress(); });
      await act(async () => { button(tree.root, 'Normalize Upper (2)').props.onPress(); });
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
      await act(async () => { button(tree.root, 'Normalize Upper (2)').props.onPress(); });
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
      await act(async () => { button(tree.root, 'Normalize Upper (1)').props.onPress(); });
      await act(async () => { button(tree.root, 'Normalize Upper (2)').props.onPress(); });
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
      await act(async () => { button(tree.root, 'Normalize Upper (1)').props.onPress(); });
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
      await act(async () => { button(tree.root, 'Normalize Upper (1)').props.onPress(); });
      await act(async () => { button(tree.root, 'Normalize Upper (2)').props.onPress(); });
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

    test('a picked text file uses the same review pipeline', async () => {
      const tree = await setup({ canPickFile: true, pickFile: jest.fn().mockResolvedValue(REPLY) });
      await act(async () => { button(tree.root, 'Choose normalized routines file').props.onPress(); });
      expect(text(tree.root)).toContain('Bench press → Bench Press');
    });
  });
});

