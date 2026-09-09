import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ThemeProvider } from '../theme/ThemeContext';
import { parseWorkoutNote } from '../lib/parser';
import { deriveProgressionSuggestion } from '../lib/data/progressionSuggestions';
import {
  ProgressionSuggestionCard,
  MutedProgressionRow,
  isRenderableProgressionSuggestion,
  progressionSuggestionInstanceId,
} from '../components/ProgressionSuggestionCard';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

// Real derivation output — never a hand-built record — so the card is tested
// against exactly the shape the production pass emits.
function suggestionFor(lines, name, options) {
  const { sections } = parseWorkoutNote(lines.join('\n'));
  return deriveProgressionSuggestion(sections, name, options);
}

const WEIGHTED = suggestionFor(['-Bench Press: 3x8-10', '135 10,10,10', '135 10,10,10'], 'Bench Press');
const BODYWEIGHT = suggestionFor(['-Pull-ups: 3x8-12', '12,12,12', '12,12,12'], 'Pull-ups');
const NOT_READY = suggestionFor(['-Row: 3x8-10', '135 8,8,8', '135 8,8,8'], 'Row');
const NO_HISTORY = suggestionFor(['-Curl: 3x8-10', '30 10,10,10'], 'Curl');

async function mount(ui) {
  let root;
  await act(async () => {
    root = renderer.create(<ThemeProvider>{ui}</ThemeProvider>);
  });
  return root;
}

function texts(root) {
  return root.root
    .findAll((n) => n.type === 'Text')
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.map((x) => (x == null ? '' : String(x))).join('') : String(c ?? '');
    });
}

describe('isRenderableProgressionSuggestion', () => {
  test('accepts a positive weighted suggestion with an explanation', () => {
    expect(WEIGHTED.suggested).toBe(true);
    expect(isRenderableProgressionSuggestion(WEIGHTED)).toBe(true);
  });

  test('accepts a positive bodyweight-ceiling suggestion', () => {
    expect(isRenderableProgressionSuggestion(BODYWEIGHT)).toBe(true);
  });

  test('rejects a non-suggested record', () => {
    expect(NOT_READY.suggested).toBe(false);
    expect(isRenderableProgressionSuggestion(NOT_READY)).toBe(false);
  });

  test('rejects insufficient-history and other kind:none records', () => {
    expect(isRenderableProgressionSuggestion(NO_HISTORY)).toBe(false);
  });

  test('rejects the post-deload re_entry relabel', () => {
    expect(isRenderableProgressionSuggestion({
      ...WEIGHTED, kind: 're_entry', suggested: false, heuristic: null,
    })).toBe(false);
  });

  test('rejects malformed / missing records', () => {
    expect(isRenderableProgressionSuggestion(null)).toBe(false);
    expect(isRenderableProgressionSuggestion(undefined)).toBe(false);
    expect(isRenderableProgressionSuggestion('nope')).toBe(false);
    expect(isRenderableProgressionSuggestion({ ...WEIGHTED, explanation: '' })).toBe(false);
    expect(isRenderableProgressionSuggestion({ ...WEIGHTED, explanation: undefined })).toBe(false);
  });
});

describe('progressionSuggestionInstanceId', () => {
  test('is stable for the same evidence and recommendation', () => {
    expect(progressionSuggestionInstanceId(WEIGHTED, 'bench press'))
      .toBe(progressionSuggestionInstanceId(WEIGHTED, 'bench press'));
  });

  test('changes when the evidence changes', () => {
    const changed = { ...WEIGHTED, evidence: { ...WEIGHTED.evidence, top_weight: 140 } };
    expect(progressionSuggestionInstanceId(changed, 'bench press'))
      .not.toBe(progressionSuggestionInstanceId(WEIGHTED, 'bench press'));
  });

  test('changes when the recommendation changes', () => {
    const changed = { ...WEIGHTED, heuristic: { ...WEIGHTED.heuristic, suggested_weight: 145 } };
    expect(progressionSuggestionInstanceId(changed, 'bench press'))
      .not.toBe(progressionSuggestionInstanceId(WEIGHTED, 'bench press'));
  });

  test('changes with the exercise identity', () => {
    expect(progressionSuggestionInstanceId(WEIGHTED, 'bench press'))
      .not.toBe(progressionSuggestionInstanceId(WEIGHTED, 'incline press'));
  });
});

describe('ProgressionSuggestionCard rendering', () => {
  test('shows the derivation explanation verbatim, the heuristic marker, and evidence', async () => {
    const root = await mount(<ProgressionSuggestionCard suggestion={WEIGHTED} surface="log" />);
    const allText = texts(root);
    expect(allText).toContain(WEIGHTED.explanation);
    expect(allText.some((t) => /heuristic/i.test(t))).toBe(true);
    expect(allText.some((t) => /not a guaranteed prescription/i.test(t))).toBe(true);
    // Evidence formatted straight from the record's own numbers.
    expect(allText.some((t) => t.includes('135 lb'))).toBe(true);
    expect(allText.some((t) => t.includes('10, 10, 10'))).toBe(true);
  });

  test('weighted card renders a concrete next-target recommendation from the heuristic', async () => {
    const root = await mount(<ProgressionSuggestionCard suggestion={WEIGHTED} surface="log" />);
    expect(texts(root).some((t) => t.includes('140 lb') && /3×8/.test(t))).toBe(true);
  });

  test('bodyweight card renders (explanation only, no invented weight recommendation)', async () => {
    const root = await mount(<ProgressionSuggestionCard suggestion={BODYWEIGHT} surface="analytics" />);
    const allText = texts(root);
    expect(allText).toContain(BODYWEIGHT.explanation);
    expect(allText.some((t) => /^Try .* lb/.test(t))).toBe(false);
  });

  test('exposes accessible, 44dp Dismiss and Mute controls naming the exercise', async () => {
    const root = await mount(<ProgressionSuggestionCard suggestion={WEIGHTED} surface="log" />);
    const buttons = root.root.findAll(
      (n) => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityLabel === 'string'
    );
    const labels = buttons.map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual(expect.arrayContaining([
      'Dismiss the progression suggestion for Bench Press',
      'Mute progression suggestions for Bench Press',
    ]));
    for (const b of buttons) {
      const style = Array.isArray(b.props.style) ? Object.assign({}, ...b.props.style) : b.props.style;
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  test('fires onMute and onDismiss', async () => {
    const onMute = jest.fn();
    const onDismiss = jest.fn();
    const root = await mount(
      <ProgressionSuggestionCard suggestion={WEIGHTED} surface="log" onMute={onMute} onDismiss={onDismiss} />
    );
    const byLabel = (label) => root.root.find((n) => n.props.accessibilityLabel === label);
    await act(async () => { byLabel('Mute progression suggestions for Bench Press').props.onPress(); });
    await act(async () => { byLabel('Dismiss the progression suggestion for Bench Press').props.onPress(); });
    expect(onMute).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('renders nothing for a muted exercise or a non-renderable record', async () => {
    const muted = await mount(<ProgressionSuggestionCard suggestion={WEIGHTED} muted />);
    expect(muted.toJSON()).toBeNull();
    const none = await mount(<ProgressionSuggestionCard suggestion={NOT_READY} />);
    expect(none.toJSON()).toBeNull();
  });
});

describe('MutedProgressionRow', () => {
  test('names the exercise and exposes an accessible Unmute control', async () => {
    const onUnmute = jest.fn();
    const root = await mount(<MutedProgressionRow name="Bench Press" onUnmute={onUnmute} />);
    expect(texts(root).some((t) => t.includes('muted for Bench Press'))).toBe(true);
    const btn = root.root.find((n) => n.props.accessibilityLabel === 'Unmute progression suggestions for Bench Press');
    expect(btn.props.accessibilityRole).toBe('button');
    await act(async () => { btn.props.onPress(); });
    expect(onUnmute).toHaveBeenCalledTimes(1);
  });
});
