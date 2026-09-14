import React from 'react';
import renderer from 'react-test-renderer';
import { Text, View } from 'react-native';
import { LightColors } from '../theme/colors';
import * as UI from '../components/UI';

// Card 1048: components/UI.js (~894 lines) was split by primitive family into
// components/ui/{containers,controls,workout,feedback,styles}.js, with UI.js
// kept as a pure re-export barrel so no consumer import changes. This test
// pins the barrel's export surface (enumerated from the pre-split file) and
// spot-checks that the moved primitives still render with the same
// structure, props and accessibility contract as before the split.

function flatten(style) {
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flatten));
  return style || {};
}

// Enumerated directly from `export ...` statements in UI.js before the split.
const EXPECTED_EXPORTS = [
  'SET_ROW_FONT_SIZE',
  'HeroMetric',
  'createInputStyle',
  'useInputStyle',
  'LineChart',
  'Card',
  'SectionTitle',
  'Button',
  'getSessionTone',
  'getSessionZoneCaption',
  'SessionGauge',
  'StatCard',
  'Badge',
  'Chip',
  'WorkoutHeading',
  'WorkoutSubheading',
  'ExerciseBlock',
  'SetLine',
  'AnnotationNote',
  'UnparsedRow',
  'NoteParseError',
  'ArtisanalPanel',
  'ErrorBanner',
];

describe('UI.js compatibility barrel: export-surface parity', () => {
  test('exports exactly the pre-split named export set, no more, no less', () => {
    expect(Object.keys(UI).sort()).toEqual([...EXPECTED_EXPORTS].sort());
  });

  test.each([
    'LineChart',
    'Card',
    'SectionTitle',
    'Button',
    'getSessionTone',
    'getSessionZoneCaption',
    'SessionGauge',
    'StatCard',
    'Badge',
    'Chip',
    'WorkoutHeading',
    'WorkoutSubheading',
    'ExerciseBlock',
    'SetLine',
    'AnnotationNote',
    'UnparsedRow',
    'NoteParseError',
    'ArtisanalPanel',
    'ErrorBanner',
    'createInputStyle',
    'useInputStyle',
  ])('%s is still a function export', (name) => {
    expect(typeof UI[name]).toBe('function');
  });

  test('SET_ROW_FONT_SIZE keeps its pre-split value', () => {
    expect(UI.SET_ROW_FONT_SIZE).toBe(14);
  });

  test('HeroMetric keeps its four type-scale steps', () => {
    expect(Object.keys(UI.HeroMetric).sort()).toEqual(
      ['hero', 'statPrimary', 'statSecondary', 'statTertiary'].sort()
    );
    expect(UI.HeroMetric.hero).toEqual({ fontSize: 48, fontWeight: '900', lineHeight: 52 });
    expect(UI.HeroMetric.statTertiary).toEqual({ fontSize: 20, fontWeight: '900' });
  });

  test('createInputStyle builds the identical shared text-input skin from a palette', () => {
    expect(UI.createInputStyle(LightColors)).toEqual({
      backgroundColor: LightColors.inputBackground,
      borderWidth: 1,
      borderColor: LightColors.inputBorder,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 15,
      color: LightColors.text,
    });
  });

  test('getSessionTone/getSessionZoneCaption keep their zone boundaries (1 / 7 / 10)', () => {
    expect(UI.getSessionTone(0)).toBe('default');
    expect(UI.getSessionTone(1)).toBe('success');
    expect(UI.getSessionTone(7)).toBe('warn');
    expect(UI.getSessionTone(10)).toBe('error');
    expect(UI.getSessionZoneCaption(0)).toBe('No sessions logged');
    expect(UI.getSessionZoneCaption(1)).toBe('Cultivating mass');
    expect(UI.getSessionZoneCaption(7)).toBe('Fatigue setting in');
    expect(UI.getSessionZoneCaption(10)).toBe('Plan deload asap');
  });
});

describe('UI.js compatibility barrel: rendered structure parity', () => {
  // Button, Card, StatCard, LineChart, ErrorBanner, SetLine already have
  // dedicated coverage elsewhere (ui-button-a11y, theme-rendering,
  // interaction-target-a11y, unit-display-ui). These checks cover the
  // remaining primitives moved across containers/controls/workout/feedback.

  test('SectionTitle renders its children in the section-title text style', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(<UI.SectionTitle>Overview</UI.SectionTitle>);
    });
    const text = component.root.findByType(Text);
    expect(text.props.children).toBe('Overview');
    expect(flatten(text.props.style)).toMatchObject({ fontWeight: '700', color: LightColors.text });
  });

  test('ArtisanalPanel wraps children in the panel surface style', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(
        <UI.ArtisanalPanel>
          <Text>inner</Text>
        </UI.ArtisanalPanel>
      );
    });
    const panel = component.root.findByType(View);
    expect(flatten(panel.props.style)).toMatchObject({
      backgroundColor: LightColors.panelBackground,
      borderRadius: 24,
      overflow: 'hidden',
    });
    expect(component.root.findByType(Text).props.children).toBe('inner');
  });

  test('Chip renders its label inside the pill surface', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(<UI.Chip>New PR</UI.Chip>);
    });
    const view = component.root.findByType(View);
    expect(flatten(view.props.style)).toMatchObject({
      backgroundColor: LightColors.chipBackground,
      borderRadius: 999,
    });
    expect(component.root.findByType(Text).props.children).toBe('New PR');
  });

  test('Badge applies the dark-status label color only for improved/regressed/held', () => {
    let improved;
    renderer.act(() => {
      improved = renderer.create(<UI.Badge status="improved">Improved</UI.Badge>);
    });
    const improvedText = improved.root.findByType(Text);
    expect(flatten(improvedText.props.style).color).toBe(LightColors.textLight);

    let neutral;
    renderer.act(() => {
      neutral = renderer.create(<UI.Badge status="first_session">First</UI.Badge>);
    });
    const neutralText = neutral.root.findByType(Text);
    expect(flatten(neutralText.props.style).color).not.toBe(LightColors.textLight);
  });

  test('WorkoutHeading forwards the selectable prop and capitalize styling', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(<UI.WorkoutHeading selectable>push day</UI.WorkoutHeading>);
    });
    const text = component.root.findByType(Text);
    expect(text.props.selectable).toBe(true);
    expect(flatten(text.props.style)).toMatchObject({ textTransform: 'capitalize' });
  });

  test('WorkoutSubheading renders the label followed by its divider line', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(<UI.WorkoutSubheading>Warm-up</UI.WorkoutSubheading>);
    });
    const texts = component.root.findAllByType(Text);
    expect(texts).toHaveLength(1);
    expect(texts[0].props.children).toBe('Warm-up');
    const views = component.root.findAllByType(View);
    // Outer container + the divider line.
    expect(views.length).toBeGreaterThanOrEqual(2);
  });

  test('ExerciseBlock exposes the track toggle as a button with a truthful label/hint', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(
        <UI.ExerciseBlock name="Bench Press" isTracked={false} onToggleTrack={() => {}}>
          <Text>child</Text>
        </UI.ExerciseBlock>
      );
    });
    const toggle = component.root.find(
      (node) => node.props && node.props.accessibilityRole === 'button'
    );
    expect(toggle.props.accessibilityLabel).toBe('Track');
    expect(toggle.props.accessibilityHint).toBe(
      'Adds this exercise to Progressive Overload and starts a new tracked span'
    );
  });

  test('ExerciseBlock renders a non-interactive toggle when disabledTrack is set', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(
        <UI.ExerciseBlock name="Squat" isTracked={false} disabledTrack>
          <Text>child</Text>
        </UI.ExerciseBlock>
      );
    });
    const buttons = component.root.findAll(
      (node) => node.props && node.props.accessibilityRole === 'button'
    );
    expect(buttons).toHaveLength(0);
  });

  test('SessionGauge gates the whole deload advisory on showDeload, not just the count', () => {
    let shown;
    renderer.act(() => {
      shown = renderer.create(<UI.SessionGauge count={8} total={20} showDeload />);
    });
    const shownTexts = shown.root.findAllByType(Text).map((t) => t.props.children);
    expect(shownTexts).toContain('Fatigue setting in');
    expect(shownTexts).toContain('Building');

    let hidden;
    renderer.act(() => {
      hidden = renderer.create(<UI.SessionGauge count={8} total={20} showDeload={false} />);
    });
    const hiddenTexts = hidden.root.findAllByType(Text).map((t) => t.props.children);
    expect(hiddenTexts).not.toContain('Fatigue setting in');
    expect(hiddenTexts).not.toContain('Building');
    expect(hiddenTexts).toContain(20);
  });

  test('UnparsedRow adds the warning glyph and accessibility label only with an error', () => {
    let plain;
    renderer.act(() => {
      plain = renderer.create(<UI.UnparsedRow raw="odd line" />);
    });
    expect(plain.root.findAllByType(Text)).toHaveLength(1);
    expect(plain.root.findByType(Text).props.children).toBe('odd line');

    let errored;
    renderer.act(() => {
      errored = renderer.create(<UI.UnparsedRow raw="odd line" error="Could not parse weight" />);
    });
    const container = errored.root.findByType(View);
    expect(container.props.accessibilityLabel).toBe('Unrecognized set row: odd line. Could not parse weight');
    const errorTexts = errored.root.findAllByType(Text).map((t) => t.props.children);
    expect(errorTexts).toContain('⚠');
    expect(errorTexts).toContain('Could not parse weight');
  });

  test('NoteParseError renders a labeled warning message', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(<UI.NoteParseError message="Note too long" />);
    });
    const view = component.root.findByType(View);
    expect(view.props.accessibilityLabel).toBe('Note could not be parsed. Note too long');
    expect(component.root.findByType(Text).props.children).toBe('⚠ Note too long');
  });

  test('AnnotationNote renders nothing without text and labels its note when present', () => {
    let empty;
    renderer.act(() => {
      empty = renderer.create(<UI.AnnotationNote text={null} />);
    });
    expect(empty.toJSON()).toBeNull();

    let noted;
    renderer.act(() => {
      noted = renderer.create(<UI.AnnotationNote text="paused for water" />);
    });
    const text = noted.root.findByType(Text);
    expect(text.props.accessibilityLabel).toBe('Note: paused for water');
    expect(text.props.children).toBe('paused for water');
  });
});
