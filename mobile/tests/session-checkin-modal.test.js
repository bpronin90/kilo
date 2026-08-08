import React from 'react';
import { act } from 'react';
import render from 'react-test-renderer';
import { Modal } from 'react-native';
import { SessionCheckInModal } from '../components/SessionCheckInModal';

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: 'MaterialIcons' }));
// The palette is no longer a static export (#689): the modal resolves it
// through the theme context, whose default is the real light palette, so this
// suite exercises the shipped tokens rather than a stub.
jest.mock('../components/UI', () => ({ createInputStyle: () => ({}) }));

const baseCheckInData = {
  sessionIndex: 0,
  detectors: ['volume_drop'],
  flagged: [{ name: 'Squat', normName: 'squat', reasons: ['volume_drop'] }],
  metrics: { exercises_skipped: 0, volume_decline_pct: 40 },
};

function makeProps(overrides = {}) {
  return {
    visible: true,
    checkInData: baseCheckInData,
    currentId: 'note-1',
    currentNote: { id: 'note-1', session_checkins: {} },
    update: jest.fn().mockResolvedValue(true),
    onClose: jest.fn(),
    ...overrides,
  };
}

// Returns all nodes that have an onPress handler, in tree order.
function findPressables(root) {
  return root.findAll(node => typeof node.props?.onPress === 'function', { deep: true });
}

// The backdrop Pressable wraps the overlay and is the outermost onPress handler in the tree.
function findBackdrop(root) {
  return findPressables(root)[0];
}

// The X close button: Pressable whose great-grandchild has props.children === '✕'.
// Pressable renders View → View → [Text("✕"), …] so the content is 3 levels deep.
// In TestInstance trees, .type is a component reference (not a string), so match by props.children only.
function findCloseButton(root) {
  return findPressables(root).find(node =>
    (node.children || []).some(c1 =>
      (c1.children || []).some(c2 =>
        (c2.children || []).some(c3 => c3?.props?.children === '✕')
      )
    )
  );
}

// Finds a Pressable containing the given text anywhere in its subtree
// (mirrors findCloseButton's approach but searches all descendant Text nodes,
// regardless of nesting depth, since Pressable/Text nesting varies by button).
function findPressableWithText(root, text) {
  return findPressables(root).find(node =>
    node.findAll(n => n.props?.children === text, { deep: true }).length > 0
  );
}

function findOkTierButton(root) {
  return findPressableWithText(root, 'Normal for me');
}

function findRoughTierButton(root) {
  return findPressableWithText(root, 'It was a rough one');
}

function findSubmitButton(root) {
  return findPressableWithText(root, 'Done') || findPressableWithText(root, 'Saving…');
}

describe('SessionCheckInModal — backdrop defers (no storage write)', () => {
  it('backdrop Pressable onPress is wired to onClose and does not call update', async () => {
    const props = makeProps();
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    const backdrop = findBackdrop(instance.root);
    expect(backdrop).toBeTruthy();

    // The backdrop's onPress IS the onClose prop — defer, no storage write.
    expect(backdrop.props.onPress).toBe(props.onClose);

    await act(async () => {
      backdrop.props.onPress();
    });

    expect(props.update).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Modal onRequestClose is wired to onClose and does not call update', async () => {
    const props = makeProps();
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    const modal = instance.root.findByType(Modal);
    expect(typeof modal.props.onRequestClose).toBe('function');

    // onRequestClose IS the onClose prop — Android back = defer, no write.
    expect(modal.props.onRequestClose).toBe(props.onClose);

    await act(async () => {
      modal.props.onRequestClose();
    });

    expect(props.update).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SessionCheckInModal — explicit X dismiss writes session_checkins', () => {
  it('X button onPress calls update with a session_checkins entry then calls onClose', async () => {
    const props = makeProps();
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    const closeBtn = findCloseButton(instance.root);
    expect(closeBtn).toBeTruthy();

    // X button is NOT wired to onClose directly — it goes through handleDismiss which writes first.
    expect(closeBtn.props.onPress).not.toBe(props.onClose);

    await act(async () => {
      await closeBtn.props.onPress();
    });

    expect(props.update).toHaveBeenCalledWith(
      'note-1',
      expect.objectContaining({
        session_checkins: expect.objectContaining({
          0: expect.objectContaining({ responded_at: expect.any(String) }),
        }),
      })
    );
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('SessionCheckInModal — submit failure handling', () => {
  it('a rejected submit keeps the modal open, shows a retryable error, and does not call onClose', async () => {
    const props = makeProps({ update: jest.fn().mockRejectedValue(new Error('network down')) });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    await act(async () => {
      findOkTierButton(instance.root).props.onPress();
    });

    const submitBtn = findSubmitButton(instance.root);
    expect(submitBtn).toBeTruthy();

    await act(async () => {
      await submitBtn.props.onPress();
    });

    expect(props.update).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    // Saving state settles so the user can retry.
    expect(findSubmitButton(instance.root).props.disabled).toBe(false);
    const errorText = instance.root.findAll(n => typeof n.props?.children === 'string' && n.props.children.includes('try again'));
    expect(errorText.length).toBeGreaterThan(0);
  });

  it('a false update result keeps the modal open and shows a retryable error', async () => {
    const props = makeProps({ update: jest.fn().mockResolvedValue(false) });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    await act(async () => {
      findOkTierButton(instance.root).props.onPress();
    });

    await act(async () => {
      await findSubmitButton(instance.root).props.onPress();
    });

    expect(props.onClose).not.toHaveBeenCalled();
    expect(findSubmitButton(instance.root).props.disabled).toBe(false);
    const errorText = instance.root.findAll(n => typeof n.props?.children === 'string' && n.props.children.includes('try again'));
    expect(errorText.length).toBeGreaterThan(0);
  });

  it('retrying after a failure with a working update succeeds and calls onClose', async () => {
    const update = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(true);
    const props = makeProps({ update });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    await act(async () => {
      findOkTierButton(instance.root).props.onPress();
    });

    await act(async () => {
      await findSubmitButton(instance.root).props.onPress();
    });
    expect(props.onClose).not.toHaveBeenCalled();

    await act(async () => {
      await findSubmitButton(instance.root).props.onPress();
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('duplicate submit presses while saving are blocked to a single update call', async () => {
    let resolveUpdate;
    const update = jest.fn(() => new Promise(resolve => { resolveUpdate = resolve; }));
    const props = makeProps({ update });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    await act(async () => {
      findOkTierButton(instance.root).props.onPress();
    });

    let submitBtn = findSubmitButton(instance.root);
    await act(async () => {
      submitBtn.props.onPress();
    });

    // Modal is now mid-save; a second press must be a no-op.
    submitBtn = findSubmitButton(instance.root);
    expect(submitBtn.props.disabled).toBe(true);
    await act(async () => {
      submitBtn.props.onPress();
    });

    await act(async () => {
      resolveUpdate(true);
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SessionCheckInModal — dismiss (X button) failure handling', () => {
  it('a rejected dismiss keeps the modal open, shows a retryable error, and does not call onClose', async () => {
    const props = makeProps({ update: jest.fn().mockRejectedValue(new Error('network down')) });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    const closeBtn = findCloseButton(instance.root);
    await act(async () => {
      await closeBtn.props.onPress();
    });

    expect(props.update).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    // Saving state settles so the user can retry.
    expect(findCloseButton(instance.root).props.disabled).toBe(false);
    const errorText = instance.root.findAll(n => typeof n.props?.children === 'string' && n.props.children.includes('try again'));
    expect(errorText.length).toBeGreaterThan(0);
  });

  it('a false update result on dismiss keeps the modal open and shows a retryable error', async () => {
    const props = makeProps({ update: jest.fn().mockResolvedValue(false) });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    const closeBtn = findCloseButton(instance.root);
    await act(async () => {
      await closeBtn.props.onPress();
    });

    expect(props.onClose).not.toHaveBeenCalled();
    expect(findCloseButton(instance.root).props.disabled).toBe(false);
    const errorText = instance.root.findAll(n => typeof n.props?.children === 'string' && n.props.children.includes('try again'));
    expect(errorText.length).toBeGreaterThan(0);
  });

  it('retrying dismiss after a failure with a working update succeeds and calls onClose', async () => {
    const update = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(true);
    const props = makeProps({ update });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    let closeBtn = findCloseButton(instance.root);
    await act(async () => {
      await closeBtn.props.onPress();
    });
    expect(props.onClose).not.toHaveBeenCalled();

    closeBtn = findCloseButton(instance.root);
    await act(async () => {
      await closeBtn.props.onPress();
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('duplicate dismiss presses while saving are blocked to a single update call', async () => {
    let resolveUpdate;
    const update = jest.fn(() => new Promise(resolve => { resolveUpdate = resolve; }));
    const props = makeProps({ update });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    let closeBtn = findCloseButton(instance.root);
    await act(async () => {
      closeBtn.props.onPress();
    });

    // Modal is now mid-save; a second press must be a no-op.
    closeBtn = findCloseButton(instance.root);
    expect(closeBtn.props.disabled).toBe(true);
    await act(async () => {
      closeBtn.props.onPress();
    });

    await act(async () => {
      resolveUpdate(true);
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});


// ── D10 copy contract ────────────────────────────────────────────────────────
// The header states what was observed about the SESSION and invites a note. It
// never asks a question about the person, and it never asserts a condition.

describe('SessionCheckInModal — title selection and copy', () => {
  // Text content in tree order. A Text renders as a composite and a host node
  // with the same children, so consecutive repeats are collapsed.
  function allText(root) {
    const raw = root.findAll(n => typeof n.props?.children === 'string', { deep: true })
      .map(n => n.props.children);
    return raw.filter((t, i) => t !== raw[i - 1]);
  }

  function titleOf(instance) {
    // The header title is the first Text node in the sheet.
    return allText(instance.root)[0];
  }

  async function renderWith(checkInData) {
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...makeProps({ checkInData })} />);
    });
    return instance;
  }

  it('volume_drop names the exercises', async () => {
    const instance = await renderWith({
      ...baseCheckInData,
      detectors: ['volume_drop'],
      flagged: [{ name: 'Squat', normName: 'squat', reasons: ['volume_drop'] }],
    });
    expect(titleOf(instance)).toBe('Lighter than usual — Squat');
  });

  it('skipped alone states the observation without naming a cause', async () => {
    const instance = await renderWith({
      ...baseCheckInData,
      detectors: ['skipped'],
      flagged: [
        { name: 'Row', normName: 'row', reasons: ['skip'] },
        { name: 'Curl', normName: 'curl', reasons: ['skip'] },
      ],
    });
    expect(titleOf(instance)).toBe('More skipped than usual');
  });

  it('when both triggers fire, volume_drop wins and no clauses are joined', async () => {
    const instance = await renderWith({
      ...baseCheckInData,
      detectors: ['skipped', 'volume_drop'],
      flagged: [
        { name: 'Row', normName: 'row', reasons: ['skip'] },
        { name: 'Bench', normName: 'bench', reasons: ['volume_drop'] },
      ],
    });
    const title = titleOf(instance);
    expect(title).toBe('Lighter than usual — Bench');
    // Selection, not composition: the old ' · ' join is gone.
    expect(title).not.toContain(' · ');
  });

  it('the two-name cap with +N overflow is preserved, and the title stays inside the large-text cap', async () => {
    const instance = await renderWith({
      ...baseCheckInData,
      detectors: ['volume_drop'],
      flagged: [
        { name: 'Romanian Deadlift', normName: 'a', reasons: ['volume_drop'] },
        { name: 'Bulgarian Split Squat', normName: 'b', reasons: ['volume_drop'] },
        { name: 'Bench Press', normName: 'c', reasons: ['volume_drop'] },
        { name: 'Barbell Row', normName: 'd', reasons: ['volume_drop'] },
      ],
    });
    const title = titleOf(instance);
    expect(title).toBe('Lighter than usual — Romanian Deadlift, Bulgarian Split Squat +2');
    expect(title.length).toBeLessThanOrEqual(64);
  });

  it('no title anywhere asks how the user is, and none mentions a whole day skipped', async () => {
    for (const detectors of [['volume_drop'], ['skipped'], ['skipped', 'volume_drop']]) {
      const instance = await renderWith({ ...baseCheckInData, detectors });
      const title = titleOf(instance);
      expect(title).not.toMatch(/okay/i);
      expect(title).not.toMatch(/whole day/i);
    }
  });

  it('a historical record whose detectors no longer select a title still renders a neutral header', async () => {
    // Records written before this contract can carry `collapse` or `day_skip`
    // alone. Analytics re-opens them for editing; they are history, not
    // migrated, so the header must still say something and must stay neutral.
    for (const detectors of [['collapse'], ['day_skip'], []]) {
      const instance = await renderWith({ ...baseCheckInData, detectors, flagged: [] });
      const title = titleOf(instance);
      expect(title).toBe('Session check-in');
      expect(title).not.toMatch(/okay/i);
    }
  });

  it('the invitation is a separate node from the observation, so they announce as two utterances', async () => {
    const instance = await renderWith(baseCheckInData);
    const texts = allText(instance.root);
    expect(texts[0]).toBe('Lighter than usual — Squat');
    expect(texts[1]).toBe('Want to note why?');
  });

  it('the tiers assess the session rather than the person, and still map to ok / rough', async () => {
    const update = jest.fn().mockResolvedValue(true);
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...makeProps({ update })} />);
    });

    const okBtn = findOkTierButton(instance.root);
    const roughBtn = findRoughTierButton(instance.root);
    expect(okBtn.props.accessibilityLabel).toBe('Normal for me');
    expect(roughBtn.props.accessibilityLabel).toBe('It was a rough one');

    await act(async () => { okBtn.props.onPress(); });
    await act(async () => { findSubmitButton(instance.root).props.onPress(); });

    expect(update).toHaveBeenCalledWith('note-1', {
      session_checkins: { 0: expect.objectContaining({ status: 'ok' }) },
    });
  });

  it('Done is reachable with zero chips selected', async () => {
    const update = jest.fn().mockResolvedValue(true);
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...makeProps({ update })} />);
    });
    await act(async () => { findRoughTierButton(instance.root).props.onPress(); });
    const submit = findSubmitButton(instance.root);
    expect(submit.props.disabled).toBeFalsy();

    await act(async () => { submit.props.onPress(); });
    expect(update).toHaveBeenCalledWith('note-1', {
      session_checkins: { 0: expect.objectContaining({ status: 'rough', reasons: [] }) },
    });
  });
});

describe('SessionCheckInModal — accessibility semantics', () => {
  // Every Pressable in the tree that exposes accessibilityRole="checkbox" or
  // "button" must carry a non-empty accessibilityLabel, and any decorative
  // glyph/icon rendered inside it must be excluded from the accessibility tree
  // (accessible={false} / importantForAccessibility="no") so it isn't announced
  // a second time alongside the parent's label.
  function findByRole(root, role) {
    return root.findAll(node => node.props?.accessibilityRole === role, { deep: true });
  }

  function expectNoRedundantGlyphAnnouncement(node) {
    const glyphTexts = node.findAll(
      n => n.type === 'Text' && typeof n.props?.children !== 'undefined',
      { deep: true }
    );
    for (const glyph of glyphTexts) {
      const hidden = glyph.props.accessible === false || glyph.props.importantForAccessibility === 'no';
      expect(hidden).toBe(true);
    }
  }

  it('initial state: close control has a distinct label and no redundant glyph announcement', async () => {
    const props = makeProps();
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    const closeBtn = findCloseButton(instance.root);
    expect(closeBtn.props.accessibilityRole).toBe('button');
    expect(closeBtn.props.accessibilityLabel).toBe('Close');
    expectNoRedundantGlyphAnnouncement(closeBtn);

    // Back control is not rendered before a tier is chosen.
    const backBtns = findByRole(instance.root, 'button').filter(n => n.props.accessibilityLabel === 'Back');
    expect(backBtns.length).toBe(0);
  });

  it('selected-tier state: back control has a distinct label, separate from close', async () => {
    const props = makeProps();
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    await act(async () => {
      findOkTierButton(instance.root).props.onPress();
    });

    const backBtn = findByRole(instance.root, 'button').find(n => n.props.accessibilityLabel === 'Back');
    expect(backBtn).toBeTruthy();
    expectNoRedundantGlyphAnnouncement(backBtn);

    // The back arrow is a MaterialIcons glyph, not a Text node, so it must be
    // checked directly: importantForAccessibility="no" alone only suppresses
    // Android, so accessible={false} is also required to hide it from iOS
    // VoiceOver and avoid double-announcing alongside the parent's "Back" label.
    const backIcon = backBtn.findAll(n => n.type === 'MaterialIcons', { deep: true })[0];
    expect(backIcon).toBeTruthy();
    expect(backIcon.props.accessible).toBe(false);
    expect(backIcon.props.importantForAccessibility).toBe('no');

    const closeBtn = findCloseButton(instance.root);
    expect(closeBtn.props.accessibilityLabel).toBe('Close');
    expect(closeBtn.props.accessibilityLabel).not.toBe(backBtn.props.accessibilityLabel);
  });

  it('reason-selection state: reason chips expose checkbox semantics and toggle checked state', async () => {
    const props = makeProps();
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    await act(async () => {
      findRoughTierButton(instance.root).props.onPress();
    });

    const chip = findByRole(instance.root, 'checkbox').find(n => n.props.accessibilityLabel === 'Tired');
    expect(chip).toBeTruthy();
    expect(chip.props.accessibilityState).toEqual({ checked: false });
    expectNoRedundantGlyphAnnouncement(chip);

    await act(async () => {
      chip.props.onPress();
    });

    const chipAfter = findByRole(instance.root, 'checkbox').find(n => n.props.accessibilityLabel === 'Tired');
    expect(chipAfter.props.accessibilityState).toEqual({ checked: true });
  });

  it('the free-text field has a descriptive accessibility label', async () => {
    const props = makeProps();
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    await act(async () => {
      findRoughTierButton(instance.root).props.onPress();
    });

    const textInput = instance.root.findByProps({ multiline: true });
    expect(textInput.props.accessibilityLabel).toBe('Additional notes');
  });

  it('edit state: reason chips restored from existing data are announced as checked', async () => {
    const props = makeProps({
      isEdit: true,
      checkInData: { ...baseCheckInData, status: 'rough', reasons: ['Sore'], note: 'Prior note', responded_at: '2026-01-01T00:00:00.000Z' },
    });
    let instance;
    await act(async () => {
      instance = render.create(<SessionCheckInModal {...props} />);
    });

    const chip = findByRole(instance.root, 'checkbox').find(n => n.props.accessibilityLabel === 'Sore');
    expect(chip).toBeTruthy();
    expect(chip.props.accessibilityState).toEqual({ checked: true });

    const unselectedChip = findByRole(instance.root, 'checkbox').find(n => n.props.accessibilityLabel === 'Tired');
    expect(unselectedChip.props.accessibilityState).toEqual({ checked: false });
  });
});
