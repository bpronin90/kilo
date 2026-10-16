import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { LogEmptyState } from '../components/LogEmptyState';
import * as useEntries from '../hooks/useEntries';
import { ControlledLogScreen } from './helpers/log-screen';

installRendererCleanup();

// Suite-local mocks: each behavior suite runs in its own Jest environment.
jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

// A real in-memory store rather than bare jest.fn()s: the durable recovery
// operation journal (#696) reads back what it wrote, so a mock that forgets
// every write would make every journaled operation look unverifiable.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => { store.set(key, value); }),
    removeItem: jest.fn(async (key) => { store.delete(key); }),
    clear: jest.fn(async () => { store.clear(); }),
  };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('../components/LogEmptyState', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LogEmptyState: function MockLogEmptyState() {
      return React.createElement(View);
    }
  };
});

jest.mock('../components/SessionCheckInModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SessionCheckInModal: function MockSessionCheckInModal() {
      return React.createElement(View);
    }
  };
});

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children, headerRight }, ref) => {
    return React.createElement(View, { testID: 'screen-shell' }, headerRight, children);
  });
  return {
    ScreenShell,
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

jest.mock('../hooks/useEntries');

// ── honest first-paint and failed-read states (#737) ──────────────────────────
//
// Before this, an unresolved or failed notes read produced the same thing: an
// empty body under a populated header. The three outcomes are now distinct —
// loading paints a placeholder, a failed read paints the retry banner and
// refuses to claim the notebook is empty, and only a verified empty read
// reaches LogEmptyState.
describe('Log loading and failure states (#737)', () => {
  const NOTE = {
    id: 'note1',
    title: 'Routine A',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
    saved_at: '2026-06-01T12:00:00.000Z',
  };

  function mockNotes({ notes = [], loading = false, error = null, refresh = jest.fn() } = {}) {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes,
      currentId: notes.length ? notes[0].id : null,
      currentNote: notes.length ? notes[0] : null,
      deloadNotes: [],
      loading,
      error,
      refresh,
      selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn(),
      remove: jest.fn(),
    });
    return refresh;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
  });

  const mount = () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    return component;
  };
  const has = (component, testID) => component.root.findAll(n => n.props?.testID === testID).length > 0;
  const emptyStates = (component) => component.root.findAll(n => n.type === LogEmptyState).length;

  test('an unresolved first read paints a labelled placeholder, not a blank body', () => {
    mockNotes({ notes: [], loading: true });
    const component = mount();

    expect(has(component, 'log-skeleton')).toBe(true);
    // Loading is not emptiness.
    expect(emptyStates(component)).toBe(0);
    const skeleton = component.root.find(n => n.props?.testID === 'log-skeleton');
    expect(skeleton.props.accessibilityLabel).toBe('Loading your workout notes');
  });

  test('a refresh over already-loaded notes does not throw the screen back to a placeholder', () => {
    mockNotes({ notes: [NOTE], loading: true });
    const component = mount();

    expect(has(component, 'log-skeleton')).toBe(false);
  });

  test('a failed read shows a retry banner and never claims the notebook is empty', () => {
    const refresh = jest.fn();
    mockNotes({ notes: [], error: new Error('read failed'), refresh });
    const component = mount();

    // The banner is present…
    const banner = component.root.findAll(
      n => n.type === 'Text' && String(n.props.children ?? '').includes('Could not load workout notes.')
    );
    expect(banner.length).toBe(1);
    // …and the "create your first routine" surface is NOT.
    expect(emptyStates(component)).toBe(0);
    expect(has(component, 'log-skeleton')).toBe(false);

    const retry = component.root.find(
      n => typeof n.props?.onPress === 'function'
        && n.findAll(c => c.type === 'Text' && String(c.props.children ?? '') === 'Retry').length > 0
    );
    render.act(() => { retry.props.onPress(); });
    expect(refresh).toHaveBeenCalled();
  });

  test('only a verified empty read reaches the empty state', () => {
    mockNotes({ notes: [], loading: false, error: null });
    const component = mount();

    expect(emptyStates(component)).toBe(1);
    expect(has(component, 'log-skeleton')).toBe(false);
  });
});

// ── the pending-retry window on screen (#737 review) ──────────────────────────
//
// useWorkoutNotes.reload() used to clear `error` on the way in, so tapping the
// ErrorBanner's Retry dropped the banner while `notes` was still empty and
// `loading` already false — and Log fell through to LogEmptyState mid-retry,
// telling a user with a full notebook that they had none. The hook now holds
// the failed state until a read completes; this asserts what that looks like.
describe('Log retry does not flash the empty state (#737 review)', () => {
  const mount = () => {
    let component;
    render.act(() => { component = render.create(<ControlledLogScreen />); });
    return component;
  };
  const emptyStates = (component) => component.root.findAll(n => n.type === LogEmptyState).length;
  const has = (component, testID) => component.root.findAll(n => n.props?.testID === testID).length > 0;
  const hasBanner = (component) => component.root.findAll(
    n => n.type === 'Text' && String(n.props.children ?? '').includes('Could not load workout notes.')
  ).length > 0;

  function mockNotes({ notes = [], loading = false, error = null } = {}) {
    useEntries.useWorkoutNotes.mockReturnValue({
      notes,
      currentId: notes.length ? notes[0].id : null,
      currentNote: notes.length ? notes[0] : null,
      deloadNotes: [], loading, error,
      refresh: jest.fn(), selectCurrent: jest.fn(),
      update: jest.fn().mockResolvedValue({}), add: jest.fn(), remove: jest.fn(),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
  });

  test('a retry still in flight keeps the banner up and the empty state away', () => {
    // Mid-retry the hook holds the shape it had before the retry: the read has
    // not completed, so the last completed read is still the truth.
    mockNotes({ notes: [], loading: false, error: new Error('read failed') });
    const component = mount();

    expect(hasBanner(component)).toBe(true);
    expect(emptyStates(component)).toBe(0);
    expect(has(component, 'log-skeleton')).toBe(false);
  });

  test('once the retry resolves onto a genuinely empty notebook the empty state appears', () => {
    mockNotes({ notes: [], loading: false, error: null });
    const component = mount();

    expect(hasBanner(component)).toBe(false);
    expect(emptyStates(component)).toBe(1);
  });
});
