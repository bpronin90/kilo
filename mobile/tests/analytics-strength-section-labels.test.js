import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ThemeProvider } from '../theme/ThemeContext';
import { AnalyticsStrengthSection } from '../components/AnalyticsStrengthSection';
import { setWeightUnitPreference, __resetWeightUnitForTests } from '../lib/unitPreference';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

afterEach(() => {
  __resetWeightUnitForTests();
});

const oneK = { total: 900, squat: 300, bench: 250, deadlift: 350 };
const oneKCanonical = oneK; // lb === canonical when unit is lb

// User-reported item 4 (AnalyticsStrengthSection half): the 1K breakdown
// tap's accessibilityLabel hardcoded "pounds" even though `item.value` is
// display-space and can be kg.
describe('AnalyticsStrengthSection — plate-calculator tap announces the correct unit (user item 4)', () => {
  test('announces kilograms when displaying in kg', async () => {
    setWeightUnitPreference('kg');
    let root;
    await act(async () => {
      root = renderer.create(
        <ThemeProvider>
          <AnalyticsStrengthSection
            handleStrengthLayout={() => {}}
            isNotesLoading={false}
            oneK={{ total: 408, squat: 136, bench: 113, deadlift: 159 }}
            oneKCanonical={oneKCanonical}
            oneKChartData={[]}
          />
        </ThemeProvider>
      );
    });
    const labels = root.root
      .findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show plate loading'))
      .map((n) => n.props.accessibilityLabel);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).toContain('kilograms');
      expect(label).not.toContain('pounds');
    }
  });

  test('announces pounds when displaying in lb', async () => {
    let root;
    await act(async () => {
      root = renderer.create(
        <ThemeProvider>
          <AnalyticsStrengthSection
            handleStrengthLayout={() => {}}
            isNotesLoading={false}
            oneK={oneK}
            oneKCanonical={oneKCanonical}
            oneKChartData={[]}
          />
        </ThemeProvider>
      );
    });
    const labels = root.root
      .findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show plate loading'))
      .map((n) => n.props.accessibilityLabel);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).toContain('pounds');
    }
  });
});

// #1245: the 1K explainer uses the shared info icon anchored beside its heading.
describe('AnalyticsStrengthSection — 1K explainer uses the shared info icon', () => {
  const texts = (node) => node.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join('')).filter(Boolean);
  test('the icon sits beside "1K Progress"; the explanation is hidden until tapped', async () => {
    let root;
    await act(async () => {
      root = renderer.create(
        <ThemeProvider>
          <AnalyticsStrengthSection
            handleStrengthLayout={() => {}}
            isNotesLoading={false}
            oneK={oneK}
            oneKCanonical={oneKCanonical}
            oneKChartData={[]}
          />
        </ThemeProvider>
      );
    });
    const toggle = root.root.findAll(n => n.props.testID === 'onek-info-toggle' && n.props.accessibilityRole === 'button')[0];
    expect(toggle.props.accessibilityLabel).toBe('How is the 1K calculated?');
    // Same row as the heading: the nearest ancestor holding the heading holds
    // nothing else from the card (not the 1K value below it).
    let row = toggle.parent;
    while (!texts(row).includes('1K Progress')) row = row.parent;
    expect(texts(row).some(t => t.includes('900'))).toBe(false);
    expect(texts(root.root)).not.toContain('How is this calculated?');
    expect(texts(root.root).some(t => t.includes('most recent complete cycle'))).toBe(false);
    await act(async () => { toggle.props.onPress(); });
    expect(texts(root.root).some(t => t.includes('most recent complete cycle'))).toBe(true);
  });
});

// #1246: Big 3 Mapping sits directly under the 1K panel, ahead of suggestion rows.
describe('AnalyticsStrengthSection — Big 3 Mapping placement (#1246)', () => {
  test('renders the mapping slot after the 1K panel and before progression rows', async () => {
    let root;
    await act(async () => {
      root = renderer.create(
        <ThemeProvider>
          <AnalyticsStrengthSection
            handleStrengthLayout={() => {}}
            isNotesLoading={false}
            oneK={oneK}
            oneKCanonical={oneKCanonical}
            oneKChartData={[]}
            big3Mapping={<Text testID="big3-slot">Big 3 Mapping</Text>}
            mutedProgressionRows={[{ key: 'bench', name: 'Bench Press' }]}
          />
        </ThemeProvider>
      );
    });
    const json = JSON.stringify(root.toJSON());
    const at = (s) => json.indexOf(s);
    expect(at('1K Progress')).toBeGreaterThan(-1);
    expect(at('big3-slot')).toBeGreaterThan(at('1K Progress'));
    expect(at('analytics-progression-suggestions')).toBeGreaterThan(at('big3-slot'));
  });
});
