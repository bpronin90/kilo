// Android Back handler-ownership regression (#527): all tab screens stay mounted
// under display:none, so a stale hidden-tab handler could otherwise outrace the
// visible tab's handler after a tab switch. These tests mount the real LogScreen
// and WeightScreen (not stubs) alongside the app shell to prove that exactly the
// active tab's in-tab state intercepts Android hardware Back, across tab-switch
// sequences, and that ownership does not leak once a tab is left.

import React from 'react';
import renderer from 'react-test-renderer';
import { BackHandler, Platform } from 'react-native';
import App, { normalizeNavTarget, CLOUD_SYNC_NAV_TARGET } from '../App';
import * as useEntries from '../hooks/useEntries';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('expo-updates', () => ({
  useUpdates: jest.fn(() => ({ isUpdatePending: false })),
  reloadAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(null),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('../screens/HomeScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { HomeScreen: () => React.createElement(View) };
});
// Section-targeting handoffs (#717): the shell owns which Analytics section a
// handoff requests, so record every props render to assert both the section and
// that a repeated same-section request is still delivered as a distinct request.
const analyticsRenders = [];
jest.mock('../screens/AnalyticsScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AnalyticsScreen: (props) => {
      analyticsRenders.push({ section: props.section, sectionNonce: props.sectionNonce });
      return React.createElement(View);
    },
  };
});
// Typed sub-view intents (#718): the shell decides which More sub-view a typed
// intent addresses and delivers it as flat, value-stable props, so record every
// props render the same way the Analytics recorder above does. MoreScreen's own
// consumption of these props (including its sub-view whitelist) is proved
// against the real screen in app-shell-back.test.js.
const moreRenders = [];
jest.mock('../screens/MoreScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MoreScreen: (props) => {
      moreRenders.push({
        view: props.navSubviewView,
        anchor: props.navSubviewAnchor,
        key: props.navSubviewKey,
      });
      return React.createElement(View);
    },
  };
});

jest.mock('../hooks/entries/weightHooks', () => ({
  useArchivedWeightGoals: () => ({ archivedGoals: [], loading: false, refresh: jest.fn() }),
  useWeightGoal: jest.fn(),
  useWeightEntries: jest.fn(),
  reloadWeightEntries: jest.fn(),
}));

jest.mock('../hooks/useEntries');

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children, headerRight }, ref) => (
    React.createElement(View, null, headerRight, children)
  ));
  return {
    ScreenShell,
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

// WeightScreen schedules a real setTimeout for its midnight-refresh effect; fake
// timers keep that from becoming a live open handle across test runs. Fake timers
// are installed per-test in beforeEach and torn down in afterEach (#679) — NOT at
// module scope: a module-scope jest.useFakeTimers() contaminates React/
// react-test-renderer scheduler state during import-graph evaluation, and that
// contamination leaks across Jest's shared worker into the next test file.
const MOCK_NOW = new Date('2026-05-24T12:00:00Z');

let capturedTabPress = null;
jest.mock('../components/TabBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    TabBar: (props) => {
      capturedTabPress = props.onTabPress;
      return React.createElement(View, { testID: 'tab-bar' });
    },
  };
});

function findByTestID(tree, testID) {
  if (!tree) return null;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findByTestID(child, testID);
      if (found) return found;
    }
    return null;
  }
  if (tree.props?.testID === testID) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findByTestID(child, testID);
      if (found) return found;
    }
  }
  return null;
}

function getTabStyle(component, tabName) {
  const tree = component.toJSON();
  const el = findByTestID(tree, `tab-content-${tabName}`);
  if (!el) return {};
  return [].concat(el.props.style).reduce(
    (acc, s) => (s ? Object.assign(acc, s) : acc),
    {}
  );
}

const findPressableByText = (root, text) => {
  const matches = root.findAll(n => {
    if (n.type !== 'Text') return false;
    const children = n.props.children;
    const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
    return flat.includes(text);
  });
  for (const match of matches) {
    let node = match.parent;
    while (node) {
      if (node.props && typeof node.props.onPress === 'function') return node;
      node = node.parent;
    }
  }
  return null;
};

// Every tab stays mounted (display:none) at once, so a bare text search can match
// the wrong tab's identically-labeled control (e.g. both Log and Weight render an
// "Edit" button). Scope the search to one tab's subtree via its tab-content testID.
function withinTab(component, tabName) {
  return component.root.findByProps({ testID: `tab-content-${tabName}` });
}

const CURRENT_NOTE = {
  id: 'note1',
  title: 'Routine A',
  raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
  saved_at: '2026-06-01T12:00:00.000Z',
};

const WEIGHT_ENTRY = {
  id: 'e1',
  date: '2026-05-24',
  logged_at: '2026-05-24T08:00:00Z',
  weight_value: 185,
  weight_unit: 'lb',
  note: '',
};

const WEIGHT_GOAL = { target_weight: 170, target_date: '2026-07-01', start_weight: 190 };

describe('Android Back handler ownership across tab switches (#527)', () => {
  let addListenerSpy;
  let component;
  let originalOS;
  let mockUpdateNote;

  beforeAll(() => {
    originalOS = Platform.OS;
    Platform.OS = 'android';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  beforeEach(() => {
    // Scope fake timers to test execution only (see MOCK_NOW note above).
    jest.useFakeTimers().setSystemTime(MOCK_NOW);
    capturedTabPress = null;
    analyticsRenders.length = 0;
    moreRenders.length = 0;
    mockUpdateNote = jest.fn().mockResolvedValue({});

    useEntries.useWeightEntries.mockReturnValue({
      entries: [{ ...WEIGHT_ENTRY }],
      loading: false,
      refresh: jest.fn(),
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [CURRENT_NOTE],
      currentId: 'note1',
      currentNote: CURRENT_NOTE,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({
      goal: WEIGHT_GOAL,
      save: jest.fn(),
      clear: jest.fn(),
      archiveGoal: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue(null);
    useEntries.useAutoSync.mockReturnValue({});

    addListenerSpy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(
      (_event, handler) => ({ remove: jest.fn(), handler })
    );
    renderer.act(() => {
      component = renderer.create(<App />);
    });
  });

  afterEach(() => {
    addListenerSpy.mockRestore();
    component = null;
    capturedTabPress = null;
    // Restore real timers so neither the pending midnight-refresh setTimeout nor
    // the fake-timer install survives into the next test file on this worker.
    jest.useRealTimers();
  });

  function getLatestBackHandler() {
    const calls = addListenerSpy.mock.calls.filter(
      ([event]) => event === 'hardwareBackPress'
    );
    return calls[calls.length - 1]?.[1];
  }

  test('Back on the Log tab finishes the active current-routine editor instead of falling back to Home', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => {
      findPressableByText(withinTab(component, 'Log'), 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });
    expect(findPressableByText(withinTab(component, 'Log'), 'Edit')).toBeNull(); // now in the editor

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    expect(result).toBe(true);
    // Back closed the editor and stayed on the Log tab; it did not fall through to Home.
    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(getTabStyle(component, 'Home').display).toBe('none');
  });

  test('switching away from an editing Log tab and back preserves handler precedence for the visible tab', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => {
      findPressableByText(withinTab(component, 'Log'), 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });

    // Switch to Weight and back; the shell re-registers its own listener on every
    // tab change (activeTab dependency), which is exactly the scenario #522 found
    // could outrace an in-tab handler.
    renderer.act(() => { capturedTabPress('Weight'); });
    renderer.act(() => { capturedTabPress('Log'); });

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    expect(result).toBe(true);
    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(getTabStyle(component, 'Home').display).toBe('none');
  });

  test('a hidden Log editor cannot consume Back while another tab is active', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => {
      findPressableByText(withinTab(component, 'Log'), 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });

    // Leave Log mid-edit; its editor stays mounted (display:none) in the background.
    renderer.act(() => { capturedTabPress('Weight'); });

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    // With no in-tab state on the now-active Weight tab, Back falls back to Home —
    // the stale Log editor handler must not have intercepted it instead.
    expect(result).toBe(true);
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Weight').display).toBe('none');
  });

  test('editing the weight goal, then switching to Log, does not let Log cancel the hidden goal edit', () => {
    renderer.act(() => { capturedTabPress('Weight'); });
    renderer.act(() => {
      findPressableByText(withinTab(component, 'Weight'), 'Edit').props.onPress();
    });
    expect(findPressableByText(withinTab(component, 'Weight'), 'Save goal')).toBeTruthy();

    renderer.act(() => { capturedTabPress('Log'); });

    const handler = getLatestBackHandler();
    renderer.act(() => { handler(); });

    // Back on the now-active Log tab must not reach into the hidden Weight tab's
    // goal-edit state; the goal edit is untouched (still mounted with Save goal).
    expect(findPressableByText(withinTab(component, 'Weight'), 'Save goal')).toBeTruthy();
  });

  // --- Analytics section targeting (#717) ---

  const lastAnalyticsRender = () => analyticsRenders[analyticsRenders.length - 1];

  test('a section-targeted handoff activates Analytics and forwards the requested section', () => {
    renderer.act(() => { capturedTabPress('Analytics', 'weight'); });

    expect(getTabStyle(component, 'Analytics').display).not.toBe('none');
    expect(lastAnalyticsRender().section).toBe('weight');

    renderer.act(() => { capturedTabPress('Analytics', 'strength'); });
    expect(lastAnalyticsRender().section).toBe('strength');
  });

  // #770: every destination Home's explicit controls name, forwarded verbatim
  // and from whatever section Analytics was last sent to.
  test('every bounded section id is forwarded, including from another section', () => {
    const ids = ['overview', 'weight', 'strength', 'progressive-overload', 'recovery'];
    for (const from of ids) {
      for (const to of ids) {
        renderer.act(() => { capturedTabPress('Analytics', from); });
        renderer.act(() => { capturedTabPress('Analytics', to); });
        expect(lastAnalyticsRender().section).toBe(to);
      }
    }
  });

  test('repeating the same section handoff re-issues it as a distinct request', () => {
    for (const id of ['weight', 'strength', 'progressive-overload', 'recovery', 'overview']) {
      renderer.act(() => { capturedTabPress('Analytics', id); });
      const first = lastAnalyticsRender();

      // Leave Analytics and come back to the same section, the way a user repeating
      // the Home sparkline or Weight "See full trends" handoff would.
      renderer.act(() => { capturedTabPress('Home'); });
      renderer.act(() => { capturedTabPress('Analytics', id); });
      const second = lastAnalyticsRender();

      expect(second.section).toBe(id);
      // Same section value, so only the nonce can prove the second request landed.
      expect(second.sectionNonce).not.toBe(first.sectionNonce);
    }
  });

  test('unrelated tab navigation does not disturb the memoized Analytics tree', () => {
    // Render isolation (#717 review): the nonce exists only to re-target a
    // section. If it moved on every tab press it would change a prop on the
    // always-mounted Analytics screen during navigation that has nothing to do
    // with Analytics, forcing the hidden expensive subtree to reconcile.
    renderer.act(() => { capturedTabPress('Analytics', 'weight'); });
    const settled = lastAnalyticsRender();

    renderer.act(() => { capturedTabPress('Weight'); });
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => { capturedTabPress('More'); });
    renderer.act(() => { capturedTabPress('Home'); });

    expect(lastAnalyticsRender().sectionNonce).toBe(settled.sectionNonce);
  });

  test('a tab press without a section target clears any previous section', () => {
    renderer.act(() => { capturedTabPress('Analytics', 'strength'); });
    expect(lastAnalyticsRender().section).toBe('strength');

    renderer.act(() => { capturedTabPress('Analytics'); });

    expect(lastAnalyticsRender().section).toBe(null);
    expect(getTabStyle(component, 'Analytics').display).not.toBe('none');
  });

  // --- Typed cross-screen navigation intents (#718) ---

  const lastMoreRender = () => moreRenders[moreRenders.length - 1];

  test('a subview intent activates More and forwards the requested view and anchor', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'account', anchor: 'cloud-sync' }); });

    expect(getTabStyle(component, 'More').display).not.toBe('none');
    expect(lastMoreRender().view).toBe('account');
    expect(lastMoreRender().anchor).toBe('cloud-sync');
  });

  test('a subview intent without an anchor forwards a null anchor', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'backup' }); });

    expect(lastMoreRender().view).toBe('backup');
    expect(lastMoreRender().anchor).toBe(null);
  });

  test('repeating the same subview intent re-issues it under a later key', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'account', anchor: 'cloud-sync' }); });
    const first = lastMoreRender();

    renderer.act(() => { capturedTabPress('Home'); });
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'account', anchor: 'cloud-sync' }); });
    const second = lastMoreRender();

    expect(second.view).toBe('account');
    // Identical logical target, so only the key can prove the second request landed.
    expect(second.key).not.toBe(first.key);
  });

  // --- Cloud Sync target (#737) ---

  test('the Cloud Sync target is an ordinary typed subview intent, not a bespoke route', () => {
    expect(CLOUD_SYNC_NAV_TARGET).toEqual({ kind: 'subview', view: 'account', anchor: 'cloud-sync' });
    // It survives the shell's own normalizer, which is what makes it reach More
    // at all — nothing about Cloud Sync bypasses the #718 contract.
    expect(normalizeNavTarget('More', CLOUD_SYNC_NAV_TARGET))
      .toEqual({ kind: 'subview', view: 'account', anchor: 'cloud-sync' });
  });

  test('a repeated Cloud Sync request re-applies even without leaving the tab', () => {
    // The queued-sync notice can be pressed twice in a row from Home while More
    // is already the active tab and already on Account. The logical target never
    // changes, so only the shell-minted key can carry the second request — and
    // it must, or the second press would silently do nothing.
    renderer.act(() => { capturedTabPress('More', CLOUD_SYNC_NAV_TARGET); });
    const first = lastMoreRender();

    renderer.act(() => { capturedTabPress('More', CLOUD_SYNC_NAV_TARGET); });
    const second = lastMoreRender();

    expect(second.view).toBe('account');
    expect(second.anchor).toBe('cloud-sync');
    expect(second.key).not.toBe(first.key);
  });

  test('unrelated tab navigation does not disturb the memoized More tree', () => {
    // Same render-isolation contract the Analytics nonce has (#717, generalized
    // in #718): the sub-view key must only advance for an intent that actually
    // addresses More, never for ordinary navigation between other tabs.
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'settings' }); });
    const settled = lastMoreRender();

    renderer.act(() => { capturedTabPress('Weight'); });
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => { capturedTabPress('Analytics', 'weight'); });
    renderer.act(() => { capturedTabPress('Home'); });

    expect(lastMoreRender().key).toBe(settled.key);
  });

  test('a plain More tab press carries no subview target', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'settings' }); });
    expect(lastMoreRender().view).toBe('settings');

    renderer.act(() => { capturedTabPress('More'); });

    expect(lastMoreRender().view).toBe(null);
    expect(getTabStyle(component, 'More').display).not.toBe('none');
  });

  test('a target addressed to the wrong tab is ignored by every destination', () => {
    // A section target is only meaningful on Analytics, so pressing Log with one
    // must neither leak a section into Analytics nor invent a Log note target.
    renderer.act(() => { capturedTabPress('Log', { kind: 'section', id: 'weight' }); });

    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(lastAnalyticsRender().section).toBe(null);
    expect(lastAnalyticsRender().sectionNonce).toBe(0);
    expect(lastMoreRender().view).toBe(null);
    expect(lastMoreRender().key).toBe(0);
  });

  test('an unknown target kind is safely ignored and still performs the tab press', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'mystery', view: 'account' }); });

    expect(getTabStyle(component, 'More').display).not.toBe('none');
    expect(lastMoreRender().view).toBe(null);
    expect(lastMoreRender().key).toBe(0);
  });

  test('a malformed target of the right kind is ignored rather than half-applied', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview' }); }); // no view
    expect(lastMoreRender().view).toBe(null);
    expect(lastMoreRender().key).toBe(0);

    renderer.act(() => { capturedTabPress('Analytics', { kind: 'section', id: 'mystery' }); });
    expect(lastAnalyticsRender().section).toBe(null);
    expect(lastAnalyticsRender().sectionNonce).toBe(0);
  });

  test('the legacy bare-string Analytics section is still accepted as a typed section target', () => {
    // HomeScreen and WeightScreen call onNavigate('Analytics', 'weight') (#717)
    // and are not part of #718, so the bare form must keep working unchanged.
    renderer.act(() => { capturedTabPress('Analytics', 'strength'); });
    expect(lastAnalyticsRender().section).toBe('strength');
    expect(lastAnalyticsRender().sectionNonce).toBe(1);
  });

  test('with no active in-tab state on any tab, Back still returns a non-Home tab to Home', () => {
    renderer.act(() => { capturedTabPress('Weight'); });

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    expect(result).toBe(true);
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Weight').display).toBe('none');
  });
});

// The typed navigation-intent contract's shape validator, exercised directly
// (#718). The shell-level tests above prove routing; this block pins the exact
// accept/reject matrix, including the tab/kind pairings and the deliberate
// decision to validate shape only — the More sub-view vocabulary belongs to
// MoreScreen, so any non-empty view string is a well-formed request here.
describe('normalizeNavTarget: the typed navigation-intent contract (#718)', () => {
  test('an absent target is null', () => {
    expect(normalizeNavTarget('Analytics', null)).toBe(null);
    expect(normalizeNavTarget('Analytics', undefined)).toBe(null);
    expect(normalizeNavTarget('Log')).toBe(null);
  });

  test('section targets are accepted only on Analytics and only for known ids', () => {
    // The bounded vocabulary, extended by #770 with the three destinations
    // Home's explicit controls promise: the tab top, the Progressive Overload
    // table, and Recovery.
    for (const id of ['overview', 'weight', 'strength', 'progressive-overload', 'recovery']) {
      expect(normalizeNavTarget('Analytics', { kind: 'section', id }))
        .toEqual({ kind: 'section', id });
    }
    expect(normalizeNavTarget('Analytics', { kind: 'section', id: 'mystery' })).toBe(null);
    expect(normalizeNavTarget('Analytics', { kind: 'section' })).toBe(null);
    expect(normalizeNavTarget('Log', { kind: 'section', id: 'weight' })).toBe(null);
    expect(normalizeNavTarget('Home', { kind: 'section', id: 'weight' })).toBe(null);
  });

  test('the legacy bare Analytics section string normalizes into a section target', () => {
    for (const id of ['overview', 'weight', 'strength', 'progressive-overload', 'recovery']) {
      expect(normalizeNavTarget('Analytics', id)).toEqual({ kind: 'section', id });
    }
    expect(normalizeNavTarget('Analytics', 'mystery')).toBe(null);
    expect(normalizeNavTarget('Analytics', '')).toBe(null);
    // The bare form is an Analytics-only legacy affordance; it means nothing elsewhere.
    expect(normalizeNavTarget('More', 'weight')).toBe(null);
  });

  test('note targets are accepted only on Log and only with a non-empty id', () => {
    expect(normalizeNavTarget('Log', { kind: 'note', noteId: 'n1' }))
      .toEqual({ kind: 'note', noteId: 'n1' });
    expect(normalizeNavTarget('Log', { kind: 'note', noteId: '' })).toBe(null);
    expect(normalizeNavTarget('Log', { kind: 'note' })).toBe(null);
    expect(normalizeNavTarget('Log', { kind: 'note', noteId: 42 })).toBe(null);
    expect(normalizeNavTarget('Analytics', { kind: 'note', noteId: 'n1' })).toBe(null);
  });

  test('subview targets are accepted only on More and carry an optional string anchor', () => {
    expect(normalizeNavTarget('More', { kind: 'subview', view: 'account' }))
      .toEqual({ kind: 'subview', view: 'account', anchor: null });
    expect(normalizeNavTarget('More', { kind: 'subview', view: 'account', anchor: 'cloud-sync' }))
      .toEqual({ kind: 'subview', view: 'account', anchor: 'cloud-sync' });
    // Shape only: the shell does not own More's sub-view vocabulary, so an
    // unknown-but-well-formed name is a valid request that MoreScreen rejects.
    expect(normalizeNavTarget('More', { kind: 'subview', view: 'not-a-real-view' }))
      .toEqual({ kind: 'subview', view: 'not-a-real-view', anchor: null });
    expect(normalizeNavTarget('More', { kind: 'subview', view: '' })).toBe(null);
    expect(normalizeNavTarget('More', { kind: 'subview' })).toBe(null);
    expect(normalizeNavTarget('More', { kind: 'subview', view: 'account', anchor: 7 }))
      .toEqual({ kind: 'subview', view: 'account', anchor: null });
    expect(normalizeNavTarget('Log', { kind: 'subview', view: 'account' })).toBe(null);
  });

  test('unknown kinds and non-object targets are rejected', () => {
    expect(normalizeNavTarget('More', { kind: 'mystery', view: 'account' })).toBe(null);
    expect(normalizeNavTarget('Analytics', {})).toBe(null);
    expect(normalizeNavTarget('Analytics', 42)).toBe(null);
    expect(normalizeNavTarget('Analytics', true)).toBe(null);
    expect(normalizeNavTarget('Log', () => {})).toBe(null);
  });
});
