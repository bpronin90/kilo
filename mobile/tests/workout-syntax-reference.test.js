import React from 'react';
import render from 'react-test-renderer';
import { Modal } from 'react-native';
import { parseWorkoutNote } from '../lib/parser.js';
import {
  WorkoutSyntaxReference,
  WORKOUT_SYNTAX_EXAMPLE_LINES,
  WORKOUT_SYNTAX_EXAMPLE_TEXT,
  WORKOUT_SYNTAX_ROW_EXPLANATIONS,
} from '../components/WorkoutSyntaxReference';
import { WorkoutSyntaxModal } from '../components/WorkoutSyntaxModal';
import { HelpScreen } from '../components/HelpScreen';

jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lb' }));

// Flattens rendered <Text> nodes into strings for substring assertions.
function renderedStrings(root) {
  return root.findAllByType('Text').map(t => {
    const child = t.props.children;
    return Array.isArray(child) ? child.join('') : String(child ?? '');
  });
}

describe('WorkoutSyntaxReference — parser round-trip (#584)', () => {
  test('the exact taught example parses without error', () => {
    const result = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE_TEXT);
    expect(result.ok).toBe(true);
  });

  test('produces one section with the taught heading/subheading/exercise', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE_TEXT);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Monday');
    expect(sections[0].subheading).toBe('Lifting');
    expect(sections[0].exercises[0].name).toBe('Bench');
  });

  test('produces the taught logged-set rows (135/140/145)', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE_TEXT);
    const bench = sections[0].exercises[0];
    expect(bench.rows).toHaveLength(3);
    const raws = bench.rows.map(r => r.raw);
    expect(raws).toEqual(['135 5,5,5', '140 5,5', '145 5']);
  });

  test('the "-" line is recorded as a skipped session entry, not a logged set row', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE_TEXT);
    const bench = sections[0].exercises[0];
    // The skipped-session dash line never appears among the logged rows...
    expect(bench.rows.some(r => r.raw === '-')).toBe(false);
    // ...but is preserved as a skip marker on the exercise's session entries.
    expect(bench.session_entries.some(e => e.skipped)).toBe(true);
  });

  test('the three logged rows total 6 sets', () => {
    const { sections } = parseWorkoutNote(WORKOUT_SYNTAX_EXAMPLE_TEXT);
    const bench = sections[0].exercises[0];
    const totalSets = bench.rows
      .filter(r => !r.skipped)
      .reduce((sum, r) => sum + (r.sets ? r.sets.length : 0), 0);
    expect(totalSets).toBe(6);
  });

  test('example lines join to the example text (single source of truth)', () => {
    expect(WORKOUT_SYNTAX_EXAMPLE_LINES.join('\n')).toBe(WORKOUT_SYNTAX_EXAMPLE_TEXT);
  });
});

describe('WorkoutSyntaxReference — rendered content', () => {
  test('renders every example line', () => {
    let component;
    render.act(() => {
      component = render.create(<WorkoutSyntaxReference />);
    });
    const rendered = renderedStrings(component.root);
    for (const line of WORKOUT_SYNTAX_EXAMPLE_LINES) {
      expect(rendered).toContain(line);
    }
  });

  test('renders every row explanation', () => {
    let component;
    render.act(() => {
      component = render.create(<WorkoutSyntaxReference />);
    });
    const rendered = renderedStrings(component.root);
    for (const row of WORKOUT_SYNTAX_ROW_EXPLANATIONS) {
      expect(rendered).toContain(row.desc);
    }
  });

  test('has no nested Card/SectionTitle wrapper', () => {
    // WorkoutSyntaxReference must be a bare content block; callers own the
    // surrounding Card/sheet (docs/ui-design-rules.md §4).
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../components/WorkoutSyntaxReference.js'),
      'utf8'
    );
    expect(source).not.toMatch(/<Card[\s>]/);
    expect(source).not.toMatch(/<SectionTitle[\s>]/);
  });
});

describe('WorkoutSyntaxModal — overlay/sheet/close pattern (#584)', () => {
  test('renders nothing when not visible', () => {
    let component;
    render.act(() => {
      component = render.create(<WorkoutSyntaxModal visible={false} onClose={jest.fn()} />);
    });
    expect(component.toJSON()).toBeNull();
  });

  test('renders a transparent, fade Modal with onRequestClose wired to onClose', () => {
    const onClose = jest.fn();
    let component;
    render.act(() => {
      component = render.create(<WorkoutSyntaxModal visible onClose={onClose} />);
    });
    const modal = component.root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);
    expect(modal.props.animationType).toBe('fade');
    expect(modal.props.onRequestClose).toBe(onClose);
  });

  test('has an accessible close control wired to onClose', () => {
    const onClose = jest.fn();
    let component;
    render.act(() => {
      component = render.create(<WorkoutSyntaxModal visible onClose={onClose} />);
    });
    const closeBtn = component.root.findAll(
      node => node.props?.accessibilityLabel === 'Close workout syntax help' && typeof node.props?.onPress === 'function'
    )[0];
    expect(closeBtn).toBeTruthy();

    render.act(() => {
      closeBtn.props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('tapping the backdrop calls onClose', () => {
    const onClose = jest.fn();
    let component;
    render.act(() => {
      component = render.create(<WorkoutSyntaxModal visible onClose={onClose} />);
    });
    const pressables = component.root.findAll(node => typeof node.props?.onPress === 'function', { deep: true });
    // The backdrop Pressable wraps the overlay and is the outermost onPress handler.
    const backdrop = pressables[0];
    expect(backdrop.props.onPress).toBe(onClose);
  });

  test('renders the shared WorkoutSyntaxReference content', () => {
    let component;
    render.act(() => {
      component = render.create(<WorkoutSyntaxModal visible onClose={jest.fn()} />);
    });
    const rendered = renderedStrings(component.root);
    for (const line of WORKOUT_SYNTAX_EXAMPLE_LINES) {
      expect(rendered).toContain(line);
    }
  });
});

describe('HelpScreen consumes the shared WorkoutSyntaxReference (#584)', () => {
  test('renders the same taught example lines as the modal', () => {
    let component;
    render.act(() => {
      component = render.create(<HelpScreen onBack={jest.fn()} />);
    });
    const rendered = renderedStrings(component.root);
    for (const line of WORKOUT_SYNTAX_EXAMPLE_LINES) {
      expect(rendered).toContain(line);
    }
  });
});
