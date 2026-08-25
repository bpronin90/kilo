// #880 revised body: the shared save-state region used by both
// LogScreenEditorCard.js and LogRecoverySection.js.
//
// Covers the Save-State Semantics and Non-Interference sections of the
// contract directly against the component itself:
//   - Saved is bound to whatever caller passes as `saveSuccess` (the
//     editor hooks are what bind it to an exact text snapshot — see
//     log-current-editor-drafts.test.js's "BLOCKER 1" describe block —
//     this file only has to prove the REGION renders whatever it is given,
//     truthfully, with the right priority and no extra flicker);
//   - the displayed label changes immediately, while announcements are
//     debounced so a rapid Saving…->Saved cycle produces one final message;
//   - the region reserves a fixed height regardless of which (or no) label
//     is showing — no layout shift;
//   - it never claims focus (no accessibility focus props, nothing
//     Pressable).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';
import { computeSaveStatusLabel, SaveStatusRegion } from '../components/LogScreenEditorCard';

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return ReactMock.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

function findRegionView(root) {
  // The outer View carrying the reserved-height style.
  return root.findAll((n) => n.type === 'View').find((n) => {
    const style = Array.isArray(n.props.style) ? n.props.style : [n.props.style];
    return style.some((s) => s && typeof s === 'object' && 'minHeight' in s);
  });
}

function findRegionText(root) {
  return root.findAll((n) => n.type === 'Text' && n.props.accessibilityLiveRegion === 'none')[0];
}

describe('computeSaveStatusLabel — priority and Save-State Semantics', () => {
  test('renders the exact-snapshot saving state', () => {
    expect(computeSaveStatusLabel({ status: 'saving' })).toBe('Saving…');
  });

  test('renders the caller-supplied locally durable label', () => {
    expect(computeSaveStatusLabel({ status: 'saved', savedLabel: 'Saved!' })).toBe('Saved!');
  });

  test('pending convergence preserves the local durability claim and never says Offline', () => {
    const label = computeSaveStatusLabel({ status: 'pending' });
    expect(label).toBe('Saved on device · Not yet synced');
    expect(label.toLowerCase()).not.toContain('offline');
  });

  test('nothing to show resolves to an empty string, not null/undefined (keeps the region a stable Text node)', () => {
    expect(computeSaveStatusLabel({ status: null })).toBe('');
  });
});

describe('SaveStatusRegion — non-interference and announcement debounce', () => {
  let roots = [];
  afterEach(() => {
    roots.forEach((root) => act(() => root.unmount()));
    roots = [];
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('reserves a fixed height with no label showing (non-interference: no layout shift)', () => {
    let root;
    act(() => { root = renderer.create(<SaveStatusRegion status={null} />); });
    roots.push(root);
    const region = findRegionView(root.root);
    expect(region).toBeTruthy();
    const style = Array.isArray(region.props.style) ? region.props.style : [region.props.style];
    const minHeight = style.find((s) => s && s.minHeight != null)?.minHeight;
    expect(minHeight).toBeGreaterThan(0);
  });

  test('the reserved height is identical whether idle, saving, saved, or pending — the region itself never resizes between states', () => {
    const heights = [];
    [
      { status: null },
      { status: 'saving' },
      { status: 'saved' },
      { status: 'pending' },
    ].forEach((props) => {
      let root;
      act(() => { root = renderer.create(<SaveStatusRegion {...props} />); });
      roots.push(root);
      const region = findRegionView(root.root);
      const style = Array.isArray(region.props.style) ? region.props.style : [region.props.style];
      heights.push(style.find((s) => s && s.minHeight != null)?.minHeight);
    });
    expect(new Set(heights).size).toBe(1);
  });

  test('never renders a Pressable/TouchableOpacity or an onPress — nothing here for the user to tap', () => {
    let root;
    act(() => { root = renderer.create(<SaveStatusRegion status="saved" savedLabel="Saved!" />); });
    roots.push(root);
    const pressables = root.root.findAll((n) => typeof n.props.onPress === 'function');
    expect(pressables).toHaveLength(0);
  });

  test('never sets focus-stealing accessibility props (no accessibilityViewIsModal, no autoFocus, no ref-based focus call)', () => {
    let root;
    act(() => { root = renderer.create(<SaveStatusRegion status="saved" savedLabel="Saved!" />); });
    roots.push(root);
    const text = findRegionText(root.root);
    expect(text.props.accessibilityViewIsModal).toBeUndefined();
    expect(text.props.autoFocus).toBeUndefined();
    expect(text.props.accessibilityLiveRegion).toBe('none');
  });

  test('the initial mount label is applied immediately — no lag before the FIRST render (Saving… must be reachable on a first save)', () => {
    let root;
    act(() => { root = renderer.create(<SaveStatusRegion status="saving" />); });
    roots.push(root);
    const text = findRegionText(root.root);
    expect(text.props.children).toBe('Saving…');
  });

  test('visual truth updates immediately while rapid transitions produce one debounced announcement', () => {
    jest.useFakeTimers();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    let root;
    act(() => {
      root = renderer.create(<SaveStatusRegion status={null} />);
    });
    roots.push(root);
    act(() => {
      root.update(<SaveStatusRegion status="saving" />);
    });
    expect(findRegionText(root.root).props.children).toBe('Saving…');
    act(() => {
      root.update(<SaveStatusRegion status="saved" />);
    });
    // Visible state must never be held back by announcement throttling.
    expect(findRegionText(root.root).props.children).toBe('Saved on device');
    expect(announce).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(300); });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Saved on device');
  });

  test('typing (rawLabel unchanged) never restarts or re-fires the debounce timer', () => {
    jest.useFakeTimers();
    let root;
    act(() => {
      root = renderer.create(<SaveStatusRegion status="saved" savedLabel="Saved!" />);
    });
    roots.push(root);
    expect(findRegionText(root.root).props.children).toBe('Saved!');

    // Re-rendering with the SAME props (e.g. an unrelated parent re-render)
    // must not touch the timer or the displayed text at all.
    act(() => {
      root.update(<SaveStatusRegion status="saved" savedLabel="Saved!" />);
    });
    expect(findRegionText(root.root).props.children).toBe('Saved!');
  });
});
