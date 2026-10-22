import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ThemeProvider } from '../theme/ThemeContext';
import { AnalyticsTrainingBreakdown } from '../components/AnalyticsTrainingBreakdown';
import { deriveTrainingBreakdown } from '../lib/data/trainingBreakdown';
import { parseWorkoutNote } from '../lib/parser';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => 'light') }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

const TEXT = [
  'Monday', '-Barbell Bench Press: 3x5', '135 5,5,5', '-Mystery Machine Thing: 3x10', '50 10,10',
  '-Plank: 3x30s', '30', '30',
].join('\n');
const breakdown = deriveTrainingBreakdown({ allSections: parseWorkoutNote(TEXT).sections });

async function render(props) {
  let root;
  await act(async () => {
    root = renderer.create(<ThemeProvider><AnalyticsTrainingBreakdown {...props} /></ThemeProvider>);
  });
  return root;
}
const texts = (root) => root.root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
const press = async (root, testID) => {
  await act(async () => { root.root.findByProps({ testID }).props.onPress(); });
};

describe('AnalyticsTrainingBreakdown (#1580)', () => {
  test('ready state labels its scope and opens on the Movement view with coverage and unclassified', async () => {
    const root = await render({ breakdown });
    const all = texts(root).join('|');
    expect(all).toContain('Eligible ordinary history');
    expect(all).toContain('5 completed sets across 3 exercises');
    expect(root.root.findAllByProps({ testID: 'training-breakdown-movement-unclassified' }).length).toBeGreaterThan(0);
    expect(texts(root)).toContain('Movement classified: 3 of 5 sets (60%)');
    expect(texts(root).some((t) => t.includes('Mystery Machine Thing'))).toBe(true);
    expect(root.root.findAllByProps({ testID: 'training-breakdown-timed' }).length).toBeGreaterThan(0);
  });

  test('Muscles view separates primary and secondary and explains the overlap', async () => {
    const root = await render({ breakdown });
    await press(root, 'training-breakdown-view-muscles');
    const all = texts(root).join('|');
    expect(all).toContain('Primary target sets');
    expect(all).toContain('Secondary involvement sets');
    expect(all).toMatch(/several muscles/);
    expect(all).toContain('Primary muscles known: 3 of 5 sets (60%)');
  });

  test('Equipment view says a set can involve several implements and reports unknown', async () => {
    const root = await render({ breakdown });
    await press(root, 'training-breakdown-view-equipment');
    const all = texts(root).join('|');
    expect(all).toMatch(/several implements/);
    expect(all).toContain('Unknown equipment');
    expect(all).toContain('Equipment known: 3 of 5 sets (60%)');
  });

  test('pending, error and empty states render distinct copy', async () => {
    expect(texts(await render({ breakdown: null, isLoading: true })).join('|')).toContain('Reading your training history');
    expect(texts(await render({ breakdown: null, hasError: true })).join('|')).toContain('could not be read');
    const empty = await render({ breakdown: deriveTrainingBreakdown(null) });
    expect(empty.root.findAllByProps({ testID: 'training-breakdown-empty' }).length).toBeGreaterThan(0);
  });

  test('active Recovery labels the section as paused baseline history', async () => {
    const root = await render({ breakdown, paused: true });
    expect(texts(root)).toContain('Paused during Recovery · baseline history');
    const normal = await render({ breakdown });
    expect(normal.root.findAllByProps({ testID: 'training-breakdown-paused' })).toHaveLength(0);
  });

  test('long lists are bounded behind Show all', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, label: `Item ${i}`, sets: 12 - i, exercises: [{ name: `Ex ${i}`, sets: 1 }] }));
    const big = { ...breakdown, equipment: { ...breakdown.equipment, items: many } };
    const root = await render({ breakdown: big });
    await press(root, 'training-breakdown-view-equipment');
    expect(root.root.findAllByProps({ testID: 'training-breakdown-equipment-e7' }).length).toBeGreaterThan(0);
    expect(root.root.findAllByProps({ testID: 'training-breakdown-equipment-e8' })).toHaveLength(0);
    await press(root, 'training-breakdown-show-all');
    expect(root.root.findAllByProps({ testID: 'training-breakdown-equipment-e11' }).length).toBeGreaterThan(0);
  });
});
