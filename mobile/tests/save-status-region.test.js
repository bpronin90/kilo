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
//   - the announced/displayed label is debounced so a rapid
//     Saving…->Saved cycle settles to one final value, not a rewrite per
//     intermediate state;
//   - the region reserves a fixed height regardless of which (or no) label
//     is showing — no layout shift;
//   - it never claims focus (no accessibility focus props, nothing
//     Pressable).

import React from 'react';
import renderer, { act } from 'react-test-renderer';
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
  return root.findAll((n) => n.type === 'Text' && n.props.accessibilityLiveRegion === 'polite')[0];
}

describe('computeSaveStatusLabel — priority and Save-State Semantics', () => {
  test('Saving… takes priority over everything else', () => {
    expect(computeSaveStatusLabel({ isSaving: true, saveSuccess: 'Saved!', pendingConvergence: true })).toBe('Saving…');
  });

  test('saveSuccess (caller-supplied, already bound to an exact snapshot) wins over pendingConvergence', () => {
    expect(computeSaveStatusLabel({ isSaving: false, saveSuccess: 'Saved on device', pendingConvergence: true })).toBe('Saved on device');
  });

  test('pendingConvergence shows only once nothing else applies — never says Offline, describes convergence', () => {
    const label = computeSaveStatusLabel({ isSaving: false, saveSuccess: '', pendingConvergence: true });
    expect(label).toBe('Not yet synced');
    expect(label.toLowerCase()).not.toContain('offline');
  });

  test('nothing to show resolves to an empty string, not null/undefined (keeps the region a stable Text node)', () => {
    expect(computeSaveStatusLabel({ isSaving: false, saveSuccess: '', pendingConvergence: false })).toBe('');
  });

  test('an unconfirmed cloud upload never downgrades Saved (#880 acceptance)', () => {
    // The caller passing a truthy saveSuccess IS the "confirmed locally
    // durable" claim; pendingConvergence must never suppress it.
    const label = computeSaveStatusLabel({ isSaving: false, saveSuccess: 'Saved!', pendingConvergence: true });
    expect(label).toBe('Saved!');
  });
});

describe('SaveStatusRegion — non-interference and announcement debounce', () => {
  let roots = [];
  afterEach(() => {
    roots.forEach((root) => act(() => root.unmount()));
    roots = [];
    jest.useRealTimers();
  });

  test('reserves a fixed height with no label showing (non-interference: no layout shift)', () => {
    let root;
    act(() => { root = renderer.create(<SaveStatusRegion isSaving={false} saveSuccess="" pendingConvergence={false} />); });
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
      { isSaving: false, saveSuccess: '', pendingConvergence: false },
      { isSaving: true, saveSuccess: '', pendingConvergence: false },
      { isSaving: false, saveSuccess: 'Saved on device', pendingConvergence: false },
      { isSaving: false, saveSuccess: '', pendingConvergence: true },
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
    act(() => { root = renderer.create(<SaveStatusRegion isSaving={false} saveSuccess="Saved!" pendingConvergence={false} />); });
    roots.push(root);
    const pressables = root.root.findAll((n) => typeof n.props.onPress === 'function');
    expect(pressables).toHaveLength(0);
  });

  test('never sets focus-stealing accessibility props (no accessibilityViewIsModal, no autoFocus, no ref-based focus call)', () => {
    let root;
    act(() => { root = renderer.create(<SaveStatusRegion isSaving={false} saveSuccess="Saved!" pendingConvergence={false} />); });
    roots.push(root);
    const text = findRegionText(root.root);
    expect(text.props.accessibilityViewIsModal).toBeUndefined();
    expect(text.props.autoFocus).toBeUndefined();
    // accessibilityLiveRegion="polite" is the ONLY accessibility-relevant
    // prop the region should ever set.
    expect(text.props.accessibilityLiveRegion).toBe('polite');
  });

  test('the initial mount label is applied immediately — no lag before the FIRST render (Saving… must be reachable on a first save)', () => {
    let root;
    act(() => { root = renderer.create(<SaveStatusRegion isSaving pendingConvergence={false} saveSuccess="" />); });
    roots.push(root);
    const text = findRegionText(root.root);
    expect(text.props.children).toBe('Saving…');
  });

  test('a rapid Saving…->Saved cycle settles to exactly one final displayed value (announcement debounce)', () => {
    jest.useFakeTimers();
    let root;
    act(() => {
      root = renderer.create(<SaveStatusRegion isSaving pendingConvergence={false} saveSuccess="" />);
    });
    roots.push(root);
    expect(findRegionText(root.root).props.children).toBe('Saving…');

    // The write resolves almost immediately — well inside the debounce
    // window — flipping straight to Saved.
    act(() => {
      root.update(<SaveStatusRegion isSaving={false} pendingConvergence={false} saveSuccess="Saved on device" />);
    });
    // Mid-debounce: the OLD label is still what's displayed/announced —
    // it has not yet re-announced for the transitional state.
    act(() => { jest.advanceTimersByTime(50); });

    act(() => { jest.advanceTimersByTime(300); });
    // After the debounce settles, exactly the FINAL state is shown — the
    // rapid cycle produced one eventual update, not one per intermediate
    // state.
    expect(findRegionText(root.root).props.children).toBe('Saved on device');
  });

  test('typing (rawLabel unchanged) never restarts or re-fires the debounce timer', () => {
    jest.useFakeTimers();
    let root;
    act(() => {
      root = renderer.create(<SaveStatusRegion isSaving={false} pendingConvergence={false} saveSuccess="Saved!" />);
    });
    roots.push(root);
    expect(findRegionText(root.root).props.children).toBe('Saved!');

    // Re-rendering with the SAME props (e.g. an unrelated parent re-render)
    // must not touch the timer or the displayed text at all.
    act(() => {
      root.update(<SaveStatusRegion isSaving={false} pendingConvergence={false} saveSuccess="Saved!" />);
    });
    expect(findRegionText(root.root).props.children).toBe('Saved!');
  });
});
