import React from 'react';
import { act } from 'react';
import render from 'react-test-renderer';
import { Modal } from 'react-native';
import { SessionCheckInModal } from '../components/SessionCheckInModal';

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: 'MaterialIcons' }));
jest.mock('../theme/colors', () => ({ Colors: {} }));
jest.mock('../components/UI', () => ({ InputStyle: {} }));

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

// The backdrop Pressable is the first in tree order (absoluteFill, before sheet content).
function findBackdrop(root) {
  return findPressables(root)[0];
}

// The X close button is the Pressable whose text children include '✕'.
function findCloseButton(root) {
  return findPressables(root).find(node => {
    try {
      return node
        .findAll(c => typeof c.type === 'string' && c.type === 'Text', { deep: true })
        .some(t => t.props.children === '✕');
    } catch {
      return false;
    }
  });
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
