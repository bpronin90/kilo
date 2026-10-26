import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';
import { MoreScreen } from '../screens/MoreScreen';
import * as useEntries from '../hooks/useEntries';
import { LightColors } from '../theme/colors';
import { parseWorkoutNote } from '../lib/parser';
import { MAX_RAW_TEXT_LENGTH } from '../lib/parser/workoutNote.js';
import { findPressableByText, ControlledLogScreen } from './helpers/log-screen';

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

// WorkoutContentRenderer collapsed four distinct main render modes (active routine,
// active deload card, past deload view, past routine view) into one component. These
// tests pin the two axes that differ across those modes — unparsed-row color and
// whether a tracking toggle is interactive — so the modes can't silently converge.
describe('WorkoutContentRenderer: per-mode parity with main', () => {
  const { WorkoutContentRenderer } = require('../components/WorkoutContentRenderer');

  // One lifting exercise whose only entry is unparsed raw text.
  const liftingDayGroups = [
    {
      heading: 'Day 1',
      sections: [
        {
          subheading: null,
          kind: 'lifting',
          exercises: [
            {
              name: 'Bench',
              session_entries: [{ unparsed: true, raw: 'garbage text' }],
              rows: [],
              unparsed_positions: [],
              unparsed_rows: [],
            },
          ],
        },
      ],
    },
  ];

  const findRawText = (root) =>
    root.find(n => n.type === 'Text' && n.props.children === 'garbage text');

  // Regression #3: past-deload view (isDeload, no mutedUnparsed) must keep red
  // (unparsedRow / LightColors.error) styling for unparsed lifting rows, like main:1423-1459.
  test('past-deload view (isDeload only) renders unparsed lifting rows in error red', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} isDeload={true} />
      );
    });
    expect(findRawText(component.root).props.style.color).toBe(LightColors.error);
  });

  // Active deload editor card (isDeload + mutedUnparsed) was always muted on main.
  test('active deload card (mutedUnparsed) renders unparsed lifting rows muted', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} isDeload={true} mutedUnparsed={true} />
      );
    });
    expect(findRawText(component.root).props.style.color).toBe(LightColors.text);
  });

  // Regression #4: read-only past-routine view passes no onToggleTrack. The renderer
  // must NOT wire a (crashing) toggle closure, so ExerciseBlock shows no Track control.
  test('no onToggleTrack handler -> no tracking toggle rendered', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} emptyText="No exercises to display." />
      );
    });
    const root = component.root;
    const trackNodes = root.findAll(
      n => n.type === 'Text' && (n.props.children === 'Track' || n.props.children === 'Tracked')
    );
    expect(trackNodes.length).toBe(0);
  });

  // Active routine card passes a real onToggleTrack -> toggle IS interactive.
  test('with onToggleTrack handler -> tracking toggle rendered', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} onToggleTrack={jest.fn()} />
      );
    });
    const root = component.root;
    const trackNodes = root.findAll(
      n => n.type === 'Text' && (n.props.children === 'Track' || n.props.children === 'Tracked')
    );
    expect(trackNodes.length).toBeGreaterThan(0);
  });

  // #894: the accessible label must match the visible "Track"/"Tracked" text
  // exactly (ui-design-rules §11), and the hint tells a screen-reader user what
  // a sighted user reads visually elsewhere — that tapping it starts a fresh
  // tracked span (#893), even on a re-track.
  test('Track control carries an accessible label matching its visible text, plus a hint', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={liftingDayGroups} onToggleTrack={jest.fn()} />
      );
    });
    const root = component.root;
    const toggle = root.findAll(
      n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Track'
    )[0];
    expect(toggle).toBeDefined();
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityHint).toMatch(/starts a new tracked span/);
  });
});

// #615: render read-view marks and comments from the canonical { mark, comments }
// annotation shape, using real parser output so parser <-> renderer stay in sync.
describe('#615: WorkoutContentRenderer renders marks and comments', () => {
  const { WorkoutContentRenderer } = require('../components/WorkoutContentRenderer');
  const { parseWorkoutNote } = require('../lib/parser/workoutNote');

  function dayGroupsFor(note) {
    const { sections } = parseWorkoutNote(note);
    return [{ heading: null, sections }];
  }

  test('a star mark renders as a labeled, muted marker beside the set row', () => {
    const dayGroups = dayGroupsFor('-Squat\n- 225 5,5,5 *PR');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const markNode = component.root.find(
      n => n.type === 'Text' && n.props.accessibilityLabel === 'Marked: PR'
    );
    expect(markNode).toBeTruthy();
    expect(markNode.props.children).toBe('★ PR');
  });

  test('a stored `--` comment renders as a muted, accessibility-labeled note line beneath the set', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 225 5,5,5\n-- felt strong');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const noteNode = component.root.find(
      n => n.type === 'Text' && n.props.accessibilityLabel === 'Note: felt strong'
    );
    expect(noteNode).toBeTruthy();
    expect(noteNode.props.children).toBe('felt strong');
    expect(noteNode.props.style.color).toBe(LightColors.textMuted);
  });

  test('a row with no annotation renders no mark or note text', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 225 5,5,5');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const markNodes = component.root.findAll(
      n => n.type === 'Text' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Marked:')
    );
    const noteNodes = component.root.findAll(
      n => n.type === 'Text' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Note:')
    );
    expect(markNodes.length).toBe(0);
    expect(noteNodes.length).toBe(0);
  });

  test('mark and comment do not duplicate the row as raw unparsed text', () => {
    const dayGroups = dayGroupsFor('-Squat\n- 225 5,5,5 *PR\n-- easiest triple yet');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const rawTextNodes = component.root.findAll(
      n => n.type === 'Text' && n.props.children === '225 5,5,5 *PR'
    );
    expect(rawTextNodes.length).toBe(0);
  });

  // Regression: a `--` comment after a bare (no leading "- ") logged row must
  // render as a "Note: ..." line beneath that row, not as raw unparsed text.
  // Reviewer finding on #615/PR#651.
  test('a `--` comment after a bare logged row renders as a note, only once, with no raw fallback duplication', () => {
    const dayGroups = dayGroupsFor('-Bench\n225 5\n-- felt strong');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const noteNodes = component.root.findAll(
      n => n.type === 'Text' && n.props.accessibilityLabel === 'Note: felt strong'
    );
    expect(noteNodes.length).toBe(1);
    expect(noteNodes[0].props.children).toBe('felt strong');

    const rawCommentNodes = component.root.findAll(
      n => n.type === 'Text' && n.props.children === '-- felt strong'
    );
    expect(rawCommentNodes.length).toBe(0);
  });

  // #618: an inline prose tail ("225 5 - RPE 9") renders as a muted, a11y-labeled
  // note beneath the set, while the set itself still counts and never becomes a
  // phantom load row.
  test('a captured inline prose tail renders as a muted note and the set still counts', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 225 5 - RPE 9');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const noteNode = component.root.find(
      n => n.type === 'Text' && n.props.accessibilityLabel === 'Note: RPE 9'
    );
    expect(noteNode).toBeTruthy();
    expect(noteNode.props.children).toBe('RPE 9');
    expect(noteNode.props.style.color).toBe(LightColors.textMuted);

    // The set row still renders (225 lb), and the prose never appears as raw text.
    const weightNodes = component.root.findAll(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('225')
    );
    expect(weightNodes.length).toBeGreaterThan(0);
    const rawTailNodes = component.root.findAll(
      n => n.type === 'Text' && n.props.children === '225 5 - RPE 9'
    );
    expect(rawTailNodes.length).toBe(0);
  });
});

// #852: the inline read view (both the full-scale routine rendering and
// Recovery's `compact` mode) must show a kg-marked set's converted whole-lb
// value AND visibly indicate that a conversion happened — not just print a
// number. Both modes share the same grouping/labeling approach (see
// WorkoutContentRenderer.js's CompactSetLine and UI.js's SetLine), so both
// are covered here from the same marked note text.
describe('#852: inline read view indicates a kg-marked set was converted', () => {
  const { WorkoutContentRenderer } = require('../components/WorkoutContentRenderer');
  const { parseWorkoutNote } = require('../lib/parser/workoutNote');

  function dayGroupsFor(note) {
    const { sections } = parseWorkoutNote(note);
    return [{ heading: null, sections }];
  }

  test('full-scale rendering: shows the converted whole-lb value and the original kg number', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 40kg 10');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const weightNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88')
    );
    expect(weightNode).toBeTruthy();
    // Whole lb (40 kg -> 88, not 88.18), and the original kg value is visible
    // alongside it so the conversion is indicated, not just a bare number.
    expect(weightNode.props.children).toBe('88 lb (40kg)');
  });

  test('full-scale rendering: an unmarked set never shows a kg suffix', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 135 5,5,5');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const weightNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('135')
    );
    expect(weightNode.props.children).toBe('135 lb');
  });

  test('compact (Recovery) rendering: shows the converted value and the kg suffix too', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 40kg 10');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} compact={true} />);
    });
    const weightNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88')
    );
    expect(weightNode).toBeTruthy();
    expect(weightNode.props.children).toBe('88 lb (40kg)');
    expect(weightNode.props.accessibilityLabel).toBe('88 lb, converted from 40 kilograms');
  });

  test('mixed row: only the kg-marked pair shows the conversion suffix', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 40kg 10 60 8,8');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const convertedNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88')
    );
    expect(convertedNode.props.children).toBe('88 lb (40kg)');
    const plainNode = component.root.find(
      n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('60')
    );
    expect(plainNode.props.children).toBe('60 lb');
  });

  // Regression: a converted set and a genuine lb set can share the same
  // weight_value (40kg rounds to 88 lb), so grouping on the number alone
  // merged them into one group and labelled the genuine 88 lb set as
  // converted. The group must break on conversion identity too.
  test('an adjacent genuine 88 lb set is not labelled as converted', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 88 10 40kg 8');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const weightNodes = component.root
      .findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88'))
      .map(n => n.props.children);
    expect(weightNodes).toEqual(['88 lb', '88 lb (40kg)']);
  });

  // Two different kg loads can round to the same lb value (40kg and 39.9kg
  // are both 88 lb) and must stay separate: they render different suffixes.
  test('40kg and 39.9kg both rounding to 88 lb stay separate groups', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 40kg 10 39.9kg 8');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const weightNodes = component.root
      .findAll(n => n.type === 'Text' && typeof n.props.children === 'string' && n.props.children.startsWith('88'))
      .map(n => n.props.children);
    expect(weightNodes).toEqual(['88 lb (40kg)', '88 lb (39.9kg)']);
  });
});

// #616: the read view surfaces parser rejection. Per-row unparsed records show
// a non-color-only affordance (glyph + message + a11y label); a note-level
// rejection renders a visible banner instead of a blank read view.
describe('#616: WorkoutContentRenderer surfaces parser errors', () => {
  const { WorkoutContentRenderer } = require('../components/WorkoutContentRenderer');

  function dayGroupsFor(note) {
    const { sections } = parseWorkoutNote(note);
    return [{ heading: null, sections }];
  }

  test('an unparsed row shows a warning icon, the parser message, and a recovery a11y label naming the raw line', () => {
    const dayGroups = dayGroupsFor('-Bench\n- 100 x');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const root = component.root;
    // Non-color-only: a warning glyph accompanies the row.
    const glyphNodes = root.findAll(n => n.props?.name === 'warning' && typeof n.type !== 'string');
    expect(glyphNodes.length).toBeGreaterThan(0);
    // The actionable parser message is rendered.
    const hintNode = root.find(
      n => n.type === 'Text' && n.props.children === 'Invalid reps "x" — use: 8 or 8,8,8'
    );
    expect(hintNode).toBeTruthy();
    // An accessibility label names the raw line and the recovery message.
    const labeled = root.find(
      n => typeof n.props.accessibilityLabel === 'string' &&
           n.props.accessibilityLabel.startsWith('Unrecognized set row: 100 x.')
    );
    expect(labeled).toBeTruthy();
    expect(labeled.props.accessibilityLabel).toContain('Invalid reps "x"');
    // Raw text is preserved unchanged (not swallowed into the glyph string).
    expect(root.find(n => n.type === 'Text' && n.props.children === '100 x')).toBeTruthy();
  });

  test('a note-level rejection renders a labeled parse-failure banner instead of a blank read view', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WorkoutContentRenderer dayGroups={[]} noteError="Note text is too large to parse (200001 characters; limit 200000)." />
      );
    });
    const root = component.root;
    // The empty-state copy is suppressed in favor of the error banner.
    const emptyNodes = root.findAll(
      n => n.type === 'Text' && n.props.children === 'Add some exercises to see the formatted view.'
    );
    expect(emptyNodes.length).toBe(0);
    const banner = root.find(
      n => typeof n.props.accessibilityLabel === 'string' &&
           n.props.accessibilityLabel.startsWith('Note could not be parsed.')
    );
    expect(banner).toBeTruthy();
    const bannerText = root.find(
      n => n.type === 'Text' && [].concat(n.props.children).some(c => typeof c === 'string' && c.includes('too large to parse'))
    );
    expect(bannerText).toBeTruthy();
    expect(bannerText.props.style.color).toBe(LightColors.error);
  });

  // #854/G5: cardio/non-weight exercises use the same row grammar as any
  // other exercise now, so a genuinely malformed row under one still gets
  // the ordinary error glyph — it is no longer special-cased silent.
  test('a malformed row under a non-weight exercise gets the ordinary error glyph', () => {
    const dayGroups = dayGroupsFor('-Treadmill\n- 5 min easy');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const root = component.root;
    const glyphNodes = root.findAll(n => n.props?.name === 'warning' && typeof n.type !== 'string');
    expect(glyphNodes.length).toBeGreaterThan(0);
    // The raw non-weight line is still rendered.
    expect(root.find(n => n.type === 'Text' && n.props.children === '5 min easy')).toBeTruthy();
  });

  // #854/G1-p: a bare integer with no governing header declaration renders
  // visibly with no warning icon and no message — recognized but not structured data.
  test('a bare integer with no declaration renders with no error glyph', () => {
    const dayGroups = dayGroupsFor('-Bench\n225 5\n140');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    const root = component.root;
    const glyphNodes = root.findAll(n => n.props?.name === 'warning' && typeof n.type !== 'string');
    expect(glyphNodes.length).toBe(0);
    expect(root.find(n => n.type === 'Text' && n.props.children === '140')).toBeTruthy();
  });

  // #854/G4: a duration set (header-declared, e.g. "3x30 sec") renders as
  // "Ns", not a bare/blank reps column.
  test('a duration set renders as "Ns"', () => {
    const dayGroups = dayGroupsFor('-Plank 3x30 sec\n45');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    expect(component.root.find(n => n.type === 'Text' && n.props.children === '45s')).toBeTruthy();
  });

  // #854/G7a: a "-- " line with no preceding valid entry (including no open
  // exercise) is retained as a section-level annotation, not dropped.
  test('a "-- " line with no open exercise renders as a preserved section note', () => {
    const dayGroups = dayGroupsFor('+Lifting\n-- felt strong today\n-Bench\n135 5');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    expect(component.root.find(n => n.type === 'Text' && n.props.children === 'felt strong today')).toBeTruthy();
  });

  // #854/G7c: a nonblank line with no open exercise is preserved as a
  // section-level annotation, never silently dropped.
  test('an orphan line with no open exercise renders as a preserved section note', () => {
    const dayGroups = dayGroupsFor('+Lifting\nfelt good warming up\n-Bench\n135 5');
    let component;
    render.act(() => {
      component = render.create(<WorkoutContentRenderer dayGroups={dayGroups} />);
    });
    expect(component.root.find(n => n.type === 'Text' && n.props.children === 'felt good warming up')).toBeTruthy();
  });
});

// #616: end-to-end note-error transport. This drives a real oversize note from
// the store through useLogCurrentRoutineEditor → LogScreen → LogActiveRoutineCard
// → WorkoutContentRenderer and asserts the rendered parse-failure banner. Unlike
// the direct-render test above, it injects NO noteError prop, so it fails if the
// hook stops deriving noteError, LogScreen drops it, or the card fails to forward
// it — closing the transport gap flagged in review.
describe('#616: oversize note reaches the read-view failure affordance through the full path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const oversizeText = 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1);
    const currentNote = {
      id: 'note1',
      title: 'Routine A',
      raw_text: oversizeText,
      saved_at: '2026-06-01T12:00:00.000Z',
    };
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [currentNote],
      currentId: 'note1',
      currentNote,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
  });

  test('an oversize stored note renders the parse-failure banner in the current-routine read view', () => {
    const oversizeText = 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1);
    // Sanity: the note really is rejected at the parser boundary.
    expect(parseWorkoutNote(oversizeText).ok).toBe(false);

    let component;
    render.act(() => {
      component = render.create(<ControlledLogScreen initialText={oversizeText} />);
    });
    const root = component.root;

    // The banner is reached only via hook-derived noteError threaded through the
    // real component tree — no noteError prop is injected anywhere here.
    const banner = root.find(
      n => typeof n.props.accessibilityLabel === 'string' &&
           n.props.accessibilityLabel.startsWith('Note could not be parsed.')
    );
    expect(banner).toBeTruthy();
    const bannerText = root.find(
      n => n.type === 'Text' && [].concat(n.props.children).some(c => typeof c === 'string' && c.includes('too large to parse'))
    );
    expect(bannerText).toBeTruthy();

    // The blank-read-view empty state must not appear in its place.
    const emptyNodes = root.findAll(
      n => n.type === 'Text' && n.props.children === 'Add some exercises to see the formatted view.'
    );
    expect(emptyNodes.length).toBe(0);
  });
});

// ── LogEmptyState: shared syntax example regression tests (#585)
describe('LogEmptyState workout syntax example parses correctly (#585)', () => {
  // LogEmptyState is mocked at the top of this file for LogScreen tests; pull
  // the real module here so we validate the shipped component and its exports.
  const { LogEmptyState, WORKOUT_SYNTAX_EXAMPLE, WORKOUT_SYNTAX_ROWS } = jest.requireActual('../components/LogEmptyState');

  test('rendered rows are derived from the exact tested example string', () => {
    // Single source of truth: displayed rows must be the tested string split.
    expect(WORKOUT_SYNTAX_ROWS).toEqual(WORKOUT_SYNTAX_EXAMPLE.split('\n'));

    let component;
    render.act(() => {
      component = render.create(<LogEmptyState onCreateRoutine={jest.fn()} />);
    });
    const rendered = component.root.findAllByType('Text').map(t => {
      const child = t.props.children;
      return Array.isArray(child) ? child.join('') : String(child ?? '');
    });
    for (const row of WORKOUT_SYNTAX_EXAMPLE.split('\n')) {
      expect(rendered).toContain(row);
    }
  });

  test('example syntax parses without errors', () => {
    const result = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    expect(result.ok).toBe(true);
  });

  test('example produces one section Monday/Lifting/Barbell Bench Press', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Monday');
    expect(sections[0].subheading).toBe('Lifting');
    expect(sections[0].exercises[0].name).toBe('Barbell Bench Press');
  });

  test('example has 3 session rows (135/140/145)', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    const bench = sections[0].exercises[0];
    expect(bench.rows).toHaveLength(3);
    const sessionWeights = bench.rows.map(r => r.raw);
    expect(sessionWeights).toEqual(['135 5,5,5', '140 5,5 135 5', '145 5']);
  });

  test('example logs 7 total sets across 3 sessions', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    const bench = sections[0].exercises[0];
    const totalSets = bench.rows.reduce((sum, r) => sum + r.sets.length, 0);
    expect(totalSets).toBe(7);
  });

  test('example has no unparsed entries', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE);
    const bench = sections[0].exercises[0];
    const unparsedEntries = bench.session_entries.filter(e => e.unparsed);
    expect(unparsedEntries).toHaveLength(0);
  });
});

describe('#583: App Guide analytics copy matches shipped surfaces', () => {
  const renderGuideTexts = () => {
    let component;
    render.act(() => {
      component = render.create(
        <MoreScreen
          onNavigate={jest.fn()}
          onExport={jest.fn()}
          onImport={jest.fn()}
          fatigueMultiplier={1}
          onUpdateFatigueMultiplier={jest.fn()}
         
          onUpdateWeightDateEditEnabled={jest.fn()}
          onUpdateDeloadDateEditEnabled={jest.fn()}
        />
      );
    });
    const root = component.root;
    render.act(() => {
      findPressableByText(root, 'App Guide').props.onPress();
    });
    render.act(() => {
      root.findByProps({ accessibilityLabel: 'Progress & analytics' }).props.onPress();
    });
    return root.findAllByType('Text').map(t => {
      const child = t.props.children;
      return Array.isArray(child) ? child.join('') : String(child ?? '');
    });
  };

  test('describes real Analytics surfaces and drops unavailable-feature promises', () => {
    const texts = renderGuideTexts();
    const joined = texts.join('\n');

    // Corrected descriptions are present.
    expect(joined).toContain('Weight trend charts');
    expect(joined).toContain('Combined Big 3');
    // Big 3 chart prerequisites: mapped lifts and enough complete cycles.
    expect(joined).toContain('mapped squat, bench, and deadlift');
    expect(joined).toContain('enough complete logged cycles');
    // Progressive Overload rows expose all four current metrics.
    expect(joined).toContain('Progressive Overload');
    expect(joined).toContain('Est. Max');
    expect(joined).toContain('Kilo Max');
    expect(joined).toContain('best set');
    expect(joined).toContain('progress trend');
    expect(joined).toContain('When fatigue tracking is enabled');

    // Removed promises of features Kilo does not ship.
    expect(joined).not.toContain('Est. Max history');
    expect(joined).not.toContain(
      "Tracked exercises show progress charts, Est. Max history, and overload trends."
    );
  });
});
