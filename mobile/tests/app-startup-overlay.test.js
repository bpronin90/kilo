// App-level startup overlay (#1372): the branded overlay that covers the
// mounted app until Home reports local-ready. Covers the component (geometry,
// motion, reduced motion, accessibility, six KUA palettes) and the shell
// lifecycle (one-way latch, blocked content, deferred work, wipe remount).

import React from 'react';
import renderer from 'react-test-renderer';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';

jest.mock('../lib/reminderScheduler', () => ({
  installForegroundHandler: jest.fn(async () => {}),
  reconcileWorkoutReminder: jest.fn(async () => ({ workout: { enabled: false }, inferredWeekdays: [] })),
  REST_TIMER_KIND: 'rest-timer',
  remindersSupported: jest.fn(() => true),
  requestReminderPermission: jest.fn(async () => false),
  cancelReminders: jest.fn(async () => {}),
  scheduleRequests: jest.fn(async () => {}),
  setNotificationHandlerAppActive: jest.fn(),
}));

jest.mock('../storage/entries', () => ({
  ...jest.requireActual('../storage/entries'),
  loadRestTimerState: jest.fn(async () => null),
  saveRestTimerState: jest.fn(async () => {}),
}));

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
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });
jest.mock('@react-native-community/datetimepicker', () => () => null);

// Home stand-in that owns the startup claim exactly like the real screen: it
// claims while rendering and, once the test says local reads settled, releases
// the hold and signals the shell in the same effect.
jest.mock('../screens/HomeScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  const timing = require('../storage/entries/startupTiming');
  const { AppLocalReadyContext } = require('../components/AppStartupOverlay');
  function HomeScreen({ loading, onNavigate, onFirstUseStatus }) {
    const signal = React.useContext(AppLocalReadyContext);
    const [release] = React.useState(timing.claimAppLocalReady);
    React.useEffect(() => release, [release]);
    const [, bump] = React.useReducer((x) => x + 1, 0);
    globalThis.__homeNavigate = onNavigate;
    globalThis.__homeBump = bump;
    React.useEffect(() => {
      if (globalThis.__homeFirstUse) onFirstUseStatus?.(globalThis.__homeFirstUse);
    }, [onFirstUseStatus, globalThis.__homeFirstUse]);
    const settled = !loading && globalThis.__homeLocalReady;
    React.useEffect(() => {
      if (settled) { release(); signal?.(); }
    }, [settled, release, signal]);
    return React.createElement(View, { testID: 'mock-home' });
  }
  return { HomeScreen };
});
for (const [path, name] of [
  ['../screens/AnalyticsScreen', 'AnalyticsScreen'],
  ['../screens/MoreScreen', 'MoreScreen'],
  ['../screens/LogScreen', 'LogScreen'],
  ['../screens/WeightScreen', 'WeightScreen'],
]) {
  jest.doMock(path, () => {
    const React = require('react');
    const { View } = require('react-native');
    return { [name]: () => React.createElement(View) };
  });
}
jest.mock('../components/TabBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { TabBar: () => React.createElement(View, { testID: 'mock-tab-bar' }) };
});

jest.mock('../hooks/useEntries', () => ({
  CloudSyncContext: require('react').createContext(null),
  useCloudSyncStatus: jest.fn(() => ({ noticeKind: null })),
  useSyncRecovery: jest.fn(() => ({ retrySync: jest.fn() })),
  useWeightEntries: jest.fn(() => ({ entries: [], loading: false, add: jest.fn(), refresh: jest.fn() })),
  useWorkoutNotes: jest.fn(() => ({
    notes: [], currentNote: null, currentId: null, loading: false,
    add: jest.fn(), update: jest.fn(), selectCurrent: jest.fn(), refresh: jest.fn(),
  })),
  useAutoSync: jest.fn(() => ({})),
  reloadWeightEntries: jest.fn(),
  reloadWorkoutNotes: jest.fn(),
}));

jest.mock('../hooks/useAuthSession', () => ({
  useAuthSession: jest.fn(({ onDeviceDataWiped } = {}) => {
    globalThis.__onDeviceDataWiped = onDeviceDataWiped;
    return { configured: false, passwordRecovery: false, recoveryError: false, handleAuthCallbackUrl: jest.fn() };
  }),
}));

const App = require('../App').default;
const timing = require('../storage/entries/startupTiming');
const reminderScheduler = require('../lib/reminderScheduler');
const { useAutoSync } = require('../hooks/useEntries');
const {
  AppStartupOverlay, StartupBarbell, BARBELL_GEOMETRY, STARTUP_LOOP_MS, STARTUP_LOADING_LABEL,
} = require('../components/AppStartupOverlay');
const { ThemeContext, KuaStyleContext } = require('../theme/ThemeContext');
const { KUA_PALETTES, LightColors, DarkColors } = require('../theme/colors');
const { TYPOGRAPHY } = require('../theme/typography');

const flatten = (style) => StyleSheet.flatten(style) || {};
const byTestId = (c, id) => c.root.findAll((n) => n.props?.testID === id && typeof n.type === 'string');
const one = (c, id) => byTestId(c, id)[0];

// Reduce-motion: the shared hook reads the OS preference and its change
// event. Each test pins the lookup and captures the listener.
let reduceListener;
let reduceRemove;
function pinReduceMotion(value) {
  reduceListener = null;
  reduceRemove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(value));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, fn) => {
    if (event === 'reduceMotionChanged') reduceListener = fn;
    return { remove: reduceRemove };
  });
}

let loopStart;
let loopStop;
beforeEach(() => {
  jest.clearAllMocks();
  timing._resetStartupScheduling();
  globalThis.__homeLocalReady = false;
  globalThis.__homeFirstUse = null;
  loopStart = jest.fn();
  loopStop = jest.fn();
  jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: loopStart, stop: loopStop, reset: jest.fn() }));
  pinReduceMotion(false);
});
// Every mount is torn down so the shared reduce-motion listener count returns
// to zero and the next test subscribes afresh.
let mountedTrees = [];
afterEach(async () => {
  for (const c of mountedTrees) {
    try { await renderer.act(async () => c.unmount()); } catch { /* already unmounted */ }
  }
  mountedTrees = [];
  jest.restoreAllMocks();
  timing._resetStartupScheduling();
});

const flush = () => renderer.act(async () => { await new Promise((r) => setTimeout(r, 5)); });

async function mountOverlay(element = <AppStartupOverlay />) {
  let c;
  await renderer.act(async () => { c = renderer.create(element); });
  mountedTrees.push(c);
  await flush();
  return c;
}

describe('barbell geometry and motion', () => {
  test('matches the three-size design: shaft, sleeves, collars, and plates heaviest first', async () => {
    const c = await mountOverlay(<StartupBarbell animate={false} />);
    const bar = flatten(one(c, 'startup-barbell').props.style);
    expect([bar.width, bar.height]).toEqual([184, 48]);
    const shaft = flatten(one(c, 'startup-shaft').props.style);
    expect([shaft.width, shaft.height]).toEqual([102, 3]);
    expect(BARBELL_GEOMETRY.sleeve).toEqual({ width: 38, height: 4 });
    expect(BARBELL_GEOMETRY.collar).toEqual({ width: 3, height: 12 });
    // Sleeve + collar + shaft + collar + sleeve spans the bar exactly.
    expect(38 + 3 + 102 + 3 + 38).toBe(184);
    const sizes = BARBELL_GEOMETRY.plates.map(({ width, height }) => [width, height]);
    expect(sizes).toEqual([[6, 38], [5, 28], [4.5, 20]]);

    for (const side of ['left', 'right']) {
      const plates = BARBELL_GEOMETRY.plates.map((p) => flatten(one(c, `startup-plate-${side}-${p.key}`).props.style));
      plates.forEach((s, i) => {
        expect([s.width, s.height]).toEqual(sizes[i]);
        expect(s.borderRadius).toBeGreaterThan(0);
        expect(s.borderRadius).toBeLessThanOrEqual(2);
        // Vertically centered on the bar.
        expect(s.top + s.height / 2).toBe(24);
      });
      // Heaviest against the collar, lighter plates further out.
      const lefts = plates.map((s) => s.left);
      if (side === 'left') {
        expect(lefts[0] + plates[0].width).toBeLessThanOrEqual(38);
        expect(lefts[0]).toBeGreaterThan(lefts[1]);
        expect(lefts[1]).toBeGreaterThan(lefts[2]);
      } else {
        expect(lefts[0]).toBeGreaterThanOrEqual(184 - 38);
        expect(lefts[0]).toBeLessThan(lefts[1]);
        expect(lefts[1]).toBeLessThan(lefts[2]);
      }
    }
  });

  test('plates slide inward largest first on a ~1s loop, from off their loaded positions', () => {
    expect(STARTUP_LOOP_MS).toBeGreaterThanOrEqual(900);
    expect(STARTUP_LOOP_MS).toBeLessThanOrEqual(1200);
    const [heavy, medium, light] = BARBELL_GEOMETRY.plates;
    expect(heavy.start).toBeLessThan(medium.start);
    expect(medium.start).toBeLessThan(light.start);
    expect(heavy.end).toBeLessThan(light.end);
    // The settle and hold both fit inside the loop.
    expect(light.end).toBeLessThan(0.7);
  });

  test('the animated bar begins with plates off and outward, and loads to rest', async () => {
    const value = new Animated.Value(0);
    jest.spyOn(Animated, 'Value').mockImplementation(() => value);
    const c = await mountOverlay(<StartupBarbell animate />);
    expect(loopStart).toHaveBeenCalledTimes(1);
    const tx = (side, key) => flatten(one(c, `startup-plate-${side}-${key}`).props.style).transform[0].translateX;
    const op = (side, key) => flatten(one(c, `startup-plate-${side}-${key}`).props.style).opacity;
    await renderer.act(async () => { value.setValue(0); });
    expect(tx('left', 'heavy')).toBeLessThan(0);
    expect(tx('right', 'heavy')).toBeGreaterThan(0);
    expect(op('left', 'heavy')).toBe(0);
    await renderer.act(async () => { value.setValue(0.7); });
    for (const p of BARBELL_GEOMETRY.plates) {
      expect(tx('left', p.key)).toBe(0);
      expect(tx('right', p.key)).toBe(0);
      expect(op('left', p.key)).toBe(1);
    }
    // Mid-loop the heavy plate has landed while the light one is still out.
    await renderer.act(async () => { value.setValue(0.22); });
    expect(tx('left', 'heavy')).toBe(0);
    expect(tx('left', 'light')).toBeLessThan(0);
  });
});

describe('reduced motion', () => {
  // The shared hook caches the last known preference across mounts (unknown
  // reads as reduced). Seed it explicitly so each case starts from a known
  // cache rather than whatever the previous test left behind.
  async function seedCache(value) {
    const c = await mountOverlay();
    await renderer.act(async () => { reduceListener(value); });
    await renderer.act(async () => c.unmount());
    loopStart.mockClear();
    loopStop.mockClear();
  }

  test('a static loaded bar while reduced motion is on', async () => {
    pinReduceMotion(true);
    await seedCache(true);
    const c = await mountOverlay();
    expect(loopStart).not.toHaveBeenCalled();
    const s = flatten(one(c, 'startup-plate-left-heavy').props.style);
    expect(s.transform).toBeUndefined();
    expect(s.opacity).toBeUndefined();
  });

  test('nothing animates before the initial preference is known', async () => {
    let resolve;
    // Unknown reads as reduced: start from that cache, then hold the lookup.
    pinReduceMotion(true);
    await seedCache(true);
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise((r) => { resolve = r; }));
    let c;
    await renderer.act(async () => { c = renderer.create(<AppStartupOverlay />); });
    mountedTrees.push(c);
    expect(loopStart).not.toHaveBeenCalled();
    await renderer.act(async () => { resolve(false); });
    await flush();
    expect(loopStart).toHaveBeenCalledTimes(1);
    await renderer.act(async () => c.unmount());
  });

  test('follows preference changes and cleans up the loop and listener on removal', async () => {
    await seedCache(false);
    const c = await mountOverlay();
    expect(loopStart).toHaveBeenCalledTimes(1);
    await renderer.act(async () => { reduceListener(true); });
    expect(loopStop).toHaveBeenCalledTimes(1);
    expect(flatten(one(c, 'startup-plate-left-heavy').props.style).transform).toBeUndefined();
    await renderer.act(async () => { reduceListener(false); });
    expect(loopStart).toHaveBeenCalledTimes(2);
    await renderer.act(async () => c.unmount());
    expect(loopStop).toHaveBeenCalledTimes(2);
    expect(reduceRemove).toHaveBeenCalled();
  });
});

describe('overlay presentation', () => {
  test('one concise loading status; plates and copy are not separate announcements', async () => {
    const c = await mountOverlay();
    const overlay = one(c, 'app-startup-overlay');
    expect(overlay.props.accessible).toBe(true);
    expect(overlay.props.accessibilityLabel).toBe('Loading your training');
    expect(STARTUP_LOADING_LABEL).toBe('Loading your training');
    expect(overlay.props.accessibilityViewIsModal).toBe(true);
    expect(overlay.props.onStartShouldSetResponder()).toBe(true);
    const labelled = c.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel);
    expect(labelled).toHaveLength(1);
    expect(c.root.findAllByType(Text).map((t) => t.props.children)).toEqual(['Loading your training…']);
    expect(flatten(overlay.props.style).position).toBe('absolute');
  });

  const combos = [];
  for (const court of ['hardCourt', 'clayCourt', 'grassCourt']) {
    for (const mode of ['light', 'dark']) combos.push([court, mode]);
  }
  test.each(combos)('%s %s uses semantic KUA colors and Space Grotesk copy', async (court, mode) => {
    const kua = KUA_PALETTES[court][mode];
    const colors = mode === 'dark' ? DarkColors : LightColors;
    const c = await mountOverlay(
      <ThemeContext.Provider value={{ colors, mode, kuaPalette: kua, preference: mode, setPreference: () => {} }}>
        <KuaStyleContext.Provider value={kua}>
          <AppStartupOverlay />
        </KuaStyleContext.Provider>
      </ThemeContext.Provider>
    );
    expect(flatten(one(c, 'app-startup-overlay').props.style).backgroundColor).toBe(kua.background);
    for (const p of BARBELL_GEOMETRY.plates) {
      expect(flatten(one(c, `startup-plate-left-${p.key}`).props.style).backgroundColor).toBe(kua.primary);
    }
    expect(flatten(one(c, 'startup-shaft').props.style).backgroundColor).toBe(kua.onSurfaceVariant);
    const copy = flatten(c.root.findByType(Text).props.style);
    expect(copy.color).toBe(kua.onSurfaceVariant);
    expect([TYPOGRAPHY['body-md'].fontFamily, 'System', undefined]).toContain(copy.fontFamily);
    expect(String(copy.fontFamily ?? TYPOGRAPHY['body-md'].fontFamily)).not.toMatch(/Mono/);
    // Unchanged wordmark: themed letters, both fixed brand accents.
    const fills = c.root.findAll((n) => typeof n.props?.fill === 'string').map((n) => n.props.fill);
    expect(fills.filter((f) => f === '#FF5C00')).toHaveLength(2);
    expect(fills).toContain(kua.onSurface);
  });
});

describe('shell lifecycle', () => {
  async function mountApp() {
    let c;
    await renderer.act(async () => { c = renderer.create(<App />); });
    mountedTrees.push(c);
    await flush();
    return c;
  }
  async function reportLocalReady(c) {
    globalThis.__homeLocalReady = true;
    await renderer.act(async () => { globalThis.__homeBump(); });
    await flush();
  }
  const layer = (c) => one(c, 'app-shell-layer');

  test('covers the mounted app, blocking touch and accessibility, until local-ready', async () => {
    const c = await mountApp();
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(1);
    expect(byTestId(c, 'mock-home')).toHaveLength(1);
    expect(layer(c).props.pointerEvents).toBe('none');
    expect(layer(c).props.importantForAccessibility).toBe('no-hide-descendants');
    expect(layer(c).props.accessibilityElementsHidden).toBe(true);
    // Slow hydration past the fallback: still covered, no reveal on a timer.
    await renderer.act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(1);

    await reportLocalReady(c);
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(0);
    expect(layer(c).props.pointerEvents).toBe('auto');
    expect(layer(c).props.importantForAccessibility).toBe('auto');
    expect(layer(c).props.accessibilityElementsHidden).toBe(false);
    await renderer.act(async () => c.unmount());
  });

  test('verified empty alone never starts the tour over startup; local-ready releases it', async () => {
    globalThis.__homeFirstUse = 'empty';
    const c = await mountApp();
    expect(layer(c).props.pointerEvents).toBe('none');
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(1);
    const { WelcomeWalkthrough } = require('../components/WelcomeWalkthrough');
    expect(c.root.findByType(WelcomeWalkthrough).props.tour.active).toBe(false);
    await reportLocalReady(c);
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(0);
    expect(c.root.findByType(WelcomeWalkthrough).props.tour.active).toBe(true);
    expect(layer(c).props['aria-hidden']).toBe(true);
    await renderer.act(async () => c.root.findByType(WelcomeWalkthrough).props.tour.skip());
    expect(layer(c).props.pointerEvents).toBe('auto');
    expect(c.root.findByType(WelcomeWalkthrough).props.tour.active).toBe(false);
    expect(layer(c).props['aria-hidden']).toBeUndefined();
  });

  test('sync and reminders start only after the local-ready commit', async () => {
    const c = await mountApp();
    expect(reminderScheduler.reconcileWorkoutReminder).not.toHaveBeenCalled();
    expect(useAutoSync.mock.calls.every(([auth]) => auth.loading === true)).toBe(true);
    await reportLocalReady(c);
    expect(reminderScheduler.reconcileWorkoutReminder).toHaveBeenCalledTimes(1);
    expect(useAutoSync.mock.calls[useAutoSync.mock.calls.length - 1][0].loading).not.toBe(true);
    await renderer.act(async () => c.unmount());
  });

  test('later navigation and refreshes never show it again, and the destination is kept', async () => {
    const c = await mountApp();
    // A destination chosen while covered (e.g. auth recovery → More) survives.
    await renderer.act(async () => { globalThis.__homeNavigate('More'); });
    await reportLocalReady(c);
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(0);
    const visible = c.root.findAll((n) => typeof n.type === 'string' && /^tab-content-/.test(n.props.testID || ''))
      .filter((n) => flatten(n.props.style).display === 'flex').map((n) => n.props.testID);
    expect(visible).toEqual(['tab-content-More']);
    globalThis.__homeLocalReady = false;
    await renderer.act(async () => { globalThis.__homeNavigate('Weight'); });
    await renderer.act(async () => { globalThis.__homeBump(); });
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(0);
    await renderer.act(async () => c.unmount());
  });

  test('a device-wipe remount starts a new wait; the old Home cannot release it', async () => {
    const c = await mountApp();
    await reportLocalReady(c);
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(0);
    globalThis.__homeLocalReady = false;
    let remounted;
    await renderer.act(async () => { remounted = globalThis.__onDeviceDataWiped(); });
    await flush();
    await remounted;
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(1);
    // The old Home's unmount cleanup ran against its own (released) hold.
    expect(timing.isStartupBackgroundWorkHeld()).toBe(true);
    await reportLocalReady(c);
    expect(byTestId(c, 'app-startup-overlay')).toHaveLength(0);
    expect(timing.isStartupBackgroundWorkHeld()).toBe(false);
    await renderer.act(async () => c.unmount());
  });
});
