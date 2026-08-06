import React from 'react';
import renderer from 'react-test-renderer';
import { BackHandler, Alert, Platform } from 'react-native';
import App from '../App';

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

jest.mock('../screens/HomeScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { HomeScreen: () => React.createElement(View) };
});
// Typed note intents (#718): this file already mounts the REAL MoreScreen (the
// only sub-view owner) while stubbing the other tabs, so it is where the shell's
// typed-intent routing is proved end to end. The Log stub records the flat
// nav props the shell delivers; LogScreen's own consumption of them is covered
// in log-screen.test.js.
const logRenders = [];
jest.mock('../screens/LogScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LogScreen: (props) => {
      logRenders.push({ noteId: props.navNoteId, key: props.navNoteKey });
      return React.createElement(View);
    },
  };
});
jest.mock('../screens/WeightScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WeightScreen: () => React.createElement(View) };
});
const analyticsRenders = [];
jest.mock('../screens/AnalyticsScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AnalyticsScreen: (props) => {
      analyticsRenders.push({ section: props.section, nonce: props.sectionNonce });
      return React.createElement(View);
    },
  };
});
jest.mock('../hooks/useEntries', () => ({
  // Shell-owned cloud sync summary (#737) — see app-startup.test.js.
  CloudSyncContext: require('react').createContext(null),
  useCloudSyncStatus: () => ({ noticeKind: null }),
  useSyncRecovery: () => ({ retrySync: jest.fn() }),
  useWeightEntries: () => ({ entries: [], loading: false, refresh: jest.fn() }),
  useWorkoutNotes: () => ({
    notes: [],
    currentNote: null,
    currentId: null,
    loading: false,
    add: jest.fn(),
    update: jest.fn(),
    selectCurrent: jest.fn(),
    refresh: jest.fn(),
  }),
  useAutoSync: () => {},
}));

jest.mock('../storage/entries', () => ({
  exportBackup: jest.fn(),
  importBackup: jest.fn(),
  loadFatigueMultiplier: jest.fn().mockResolvedValue(1.07),
  saveFatigueMultiplier: jest.fn(),
  loadWorkoutCollapsed: jest.fn().mockResolvedValue(false),
  saveWorkoutCollapsed: jest.fn(),
  loadWeightDateEditEnabled: jest.fn().mockResolvedValue(false),
  saveWeightDateEditEnabled: jest.fn(),
  loadDeloadDateEditEnabled: jest.fn().mockResolvedValue(false),
  saveDeloadDateEditEnabled: jest.fn(),
}));

jest.mock('../lib/parser', () => ({ parseWeightEntry: jest.fn() }));
jest.mock('../lib/data', () => ({ makeWeightEntry: jest.fn() }));

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

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  return {
    ScrollContext: React.createContext({ onScroll: () => {} }),
    ScreenShell: ({ children }) => React.createElement(React.Fragment, null, children),
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

describe('App shell tab switching', () => {
  let component;

  beforeEach(() => {
    capturedTabPress = null;
    renderer.act(() => {
      component = renderer.create(<App />);
    });
  });

  afterEach(() => {
    component = null;
    capturedTabPress = null;
  });

  test('Home tab is active on initial render', () => {
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
  });

  test('non-active tabs are hidden on initial render', () => {
    expect(getTabStyle(component, 'Log').display).toBe('none');
    expect(getTabStyle(component, 'Weight').display).toBe('none');
  });

  test('pressing Log tab makes Log active and Home inactive', () => {
    renderer.act(() => {
      capturedTabPress('Log');
    });
    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(getTabStyle(component, 'Home').display).toBe('none');
  });

  test('pressing Home tab from Log restores Home as active', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => { capturedTabPress('Home'); });
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Log').display).toBe('none');
  });

  test('each tab in TABS can become active', () => {
    for (const tab of ['Log', 'Weight', 'Analytics', 'More', 'Home']) {
      renderer.act(() => { capturedTabPress(tab); });
      expect(getTabStyle(component, tab).display).not.toBe('none');
    }
  });
});

describe('typed cross-screen navigation intents (#718)', () => {
  let addListenerSpy;
  let component;
  let originalOS;

  beforeAll(() => {
    // Android so the shell's hardware-Back path is available: popping a More
    // sub-view back to the menu is the only way a user leaves one, and proving
    // a consumed intent does NOT re-open it requires getting back to the menu.
    originalOS = Platform.OS;
    Platform.OS = 'android';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  beforeEach(() => {
    capturedTabPress = null;
    logRenders.length = 0;
    analyticsRenders.length = 0;
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
  });

  function pressBack() {
    const calls = addListenerSpy.mock.calls.filter(([event]) => event === 'hardwareBackPress');
    const handler = calls[calls.length - 1]?.[1];
    renderer.act(() => { handler(); });
  }

  const hasLabel = (label) => component.root.findAllByProps({ accessibilityLabel: label }).length > 0;
  const onMoreMenu = () => hasLabel('App Guide');
  const onAboutSubview = () => hasLabel('Privacy Policy');
  const lastLogRender = () => logRenders[logRenders.length - 1];
  const lastAnalyticsRender = () => analyticsRenders[analyticsRenders.length - 1];

  // --- note kind ---

  test('a note intent activates Log and forwards the requested note under a fresh key', () => {
    renderer.act(() => { capturedTabPress('Log', { kind: 'note', noteId: 'r1' }); });

    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(lastLogRender().noteId).toBe('r1');
    expect(lastLogRender().key).toBe(1);
  });

  test('repeating the same note intent re-issues it under a later key', () => {
    renderer.act(() => { capturedTabPress('Log', { kind: 'note', noteId: 'r1' }); });
    const first = lastLogRender();

    renderer.act(() => { capturedTabPress('Home'); });
    renderer.act(() => { capturedTabPress('Log', { kind: 'note', noteId: 'r1' }); });
    const second = lastLogRender();

    expect(second.noteId).toBe('r1');
    expect(second.key).not.toBe(first.key);
  });

  test('a plain Log tab press carries no note target', () => {
    renderer.act(() => { capturedTabPress('Log', { kind: 'note', noteId: 'r1' }); });
    expect(lastLogRender().noteId).toBe('r1');

    renderer.act(() => { capturedTabPress('Log'); });

    expect(lastLogRender().noteId).toBe(null);
    expect(getTabStyle(component, 'Log').display).not.toBe('none');
  });

  test('unrelated tab navigation does not disturb the memoized Log tree', () => {
    renderer.act(() => { capturedTabPress('Log', { kind: 'note', noteId: 'r1' }); });
    const settled = lastLogRender();

    renderer.act(() => { capturedTabPress('Weight'); });
    renderer.act(() => { capturedTabPress('More'); });
    renderer.act(() => { capturedTabPress('Analytics', 'weight'); });
    renderer.act(() => { capturedTabPress('Home'); });

    expect(lastLogRender().key).toBe(settled.key);
  });

  // --- subview kind, against the real MoreScreen ---

  test('a subview intent opens that More sub-view', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'about' }); });

    expect(getTabStyle(component, 'More').display).not.toBe('none');
    expect(onAboutSubview()).toBe(true);
    expect(onMoreMenu()).toBe(false);
  });

  test('an anchored subview intent still lands on the right sub-view', () => {
    // The anchor has no consumer yet (no More sub-screen exposes one), so the
    // contract only requires that a well-formed anchored intent is not rejected.
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'about', anchor: 'attribution' }); });

    expect(onAboutSubview()).toBe(true);
  });

  test('a consumed subview intent is not replayed by later unrelated renders', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'about' }); });
    expect(onAboutSubview()).toBe(true);

    pressBack(); // sub-view -> menu
    expect(onMoreMenu()).toBe(true);

    // Navigate elsewhere and return with an ordinary tab press. The intent was
    // already consumed under its key, so nothing may re-open the sub-view.
    renderer.act(() => { capturedTabPress('Weight'); });
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => { capturedTabPress('More'); });

    expect(onMoreMenu()).toBe(true);
    expect(onAboutSubview()).toBe(false);
  });

  test('a later key for the same sub-view re-applies the intent', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'about' }); });
    pressBack();
    expect(onMoreMenu()).toBe(true);

    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'about' }); });

    expect(onAboutSubview()).toBe(true);
  });

  test('an unknown sub-view name is ignored and leaves the current view alone', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'about' }); });
    expect(onAboutSubview()).toBe(true);

    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'not-a-real-view' }); });

    expect(onAboutSubview()).toBe(true);
    expect(onMoreMenu()).toBe(false);
  });

  test('"menu" is not a targetable sub-view, so it cannot yank the user out of one', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'about' }); });

    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'menu' }); });

    expect(onAboutSubview()).toBe(true);
  });

  test('a plain More tab press preserves the sub-view the user was already on', () => {
    renderer.act(() => { capturedTabPress('More', { kind: 'subview', view: 'about' }); });

    renderer.act(() => { capturedTabPress('Home'); });
    renderer.act(() => { capturedTabPress('More'); });

    expect(onAboutSubview()).toBe(true);
  });

  // --- cross-kind safety ---

  test('a target addressed to the wrong tab is ignored by every destination', () => {
    renderer.act(() => { capturedTabPress('Log', { kind: 'section', id: 'weight' }); });

    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(lastLogRender().noteId).toBe(null);
    expect(lastLogRender().key).toBe(0);
    expect(lastAnalyticsRender().section).toBe(null);
    expect(lastAnalyticsRender().nonce).toBe(0);
    expect(onMoreMenu()).toBe(true);
  });

  test('an unknown target kind is ignored but the tab press still happens', () => {
    renderer.act(() => { capturedTabPress('Log', { kind: 'mystery', noteId: 'r1' }); });

    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(lastLogRender().noteId).toBe(null);
    expect(lastLogRender().key).toBe(0);
  });
});

describe('App shell back handler (Android)', () => {
  let addListenerSpy;
  let component;
  let originalOS;

  beforeAll(() => {
    originalOS = Platform.OS;
    Platform.OS = 'android';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  beforeEach(() => {
    capturedTabPress = null;
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
  });

  function getLatestBackHandler() {
    const calls = addListenerSpy.mock.calls.filter(
      ([event]) => event === 'hardwareBackPress'
    );
    return calls[calls.length - 1]?.[1];
  }

  test('back press from non-Home tab navigates to Home and consumes the event', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });
    expect(result).toBe(true);
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Log').display).toBe('none');
  });

  test('back press from Home tab shows exit alert and consumes the event', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });
    expect(result).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith(
      'Exit app?',
      expect.any(String),
      expect.any(Array)
    );
    alertSpy.mockRestore();
  });

  test('back press from Home tab does not change active tab', () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const handler = getLatestBackHandler();
    renderer.act(() => { handler(); });
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
  });

  test('back press from a More sub-screen returns to the More menu, not Home (#355)', () => {
    renderer.act(() => { capturedTabPress('More'); });
    const guideLink = component.root.findByProps({ accessibilityLabel: 'App Guide' });
    renderer.act(() => { guideLink.props.onPress(); });
    expect(component.root.findAllByProps({ accessibilityLabel: 'App Guide' })).toHaveLength(0);

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    // Back is consumed by the tab: it pops to the menu and stays on More.
    expect(result).toBe(true);
    expect(component.root.findByProps({ accessibilityLabel: 'App Guide' })).toBeTruthy();
    expect(getTabStyle(component, 'More').display).not.toBe('none');
    expect(getTabStyle(component, 'Home').display).toBe('none');
  });

  test('a second back from the More menu falls back to Home (#355)', () => {
    renderer.act(() => { capturedTabPress('More'); });
    const guideLink = component.root.findByProps({ accessibilityLabel: 'App Guide' });
    renderer.act(() => { guideLink.props.onPress(); });

    const handler = getLatestBackHandler();
    renderer.act(() => { handler(); }); // sub-view -> menu
    renderer.act(() => { handler(); }); // menu -> Home

    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'More').display).toBe('none');
  });
});

describe('App shell web back affordance (#314)', () => {
  let component;
  let originalOS;

  beforeAll(() => {
    originalOS = Platform.OS;
    Platform.OS = 'web';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  beforeEach(() => {
    capturedTabPress = null;
    renderer.act(() => {
      component = renderer.create(<App />);
    });
  });

  afterEach(() => {
    component = null;
    capturedTabPress = null;
  });

  // Recursively collect props of any node carrying the given accessibilityLabel.
  function findByAccessibilityLabel(node, label) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findByAccessibilityLabel(child, label);
        if (found) return found;
      }
      return null;
    }
    if (node.props?.accessibilityLabel === label) return node;
    if (node.children) {
      for (const child of node.children) {
        const found = findByAccessibilityLabel(child, label);
        if (found) return found;
      }
    }
    return null;
  }

  test('no web back control is shown on the Home tab', () => {
    const tree = component.toJSON();
    expect(findByAccessibilityLabel(tree, 'Back to Home')).toBeNull();
  });

  test('web back control appears on a non-Home tab', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    const tree = component.toJSON();
    expect(findByAccessibilityLabel(tree, 'Back to Home')).not.toBeNull();
  });

  test('pressing the web back control returns to Home', () => {
    renderer.act(() => { capturedTabPress('Weight'); });
    expect(getTabStyle(component, 'Weight').display).not.toBe('none');
    const back = component.root.findByProps({ accessibilityLabel: 'Back to Home' });
    expect(back).toBeTruthy();
    renderer.act(() => { back.props.onPress(); });
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Weight').display).toBe('none');
  });

  test('global "← Home" bar is hidden when a More sub-screen owns its own back (#355)', () => {
    renderer.act(() => { capturedTabPress('More'); });
    // On the More menu the global web back bar is still shown.
    expect(findByAccessibilityLabel(component.toJSON(), 'Back to Home')).not.toBeNull();
    const guideLink = component.root.findByProps({ accessibilityLabel: 'App Guide' });
    renderer.act(() => { guideLink.props.onPress(); });
    expect(findByAccessibilityLabel(component.toJSON(), 'Back to Home')).toBeNull();
  });
});
