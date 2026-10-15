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

// #1375: Analytics keeps its prefilled, fixed-target entry point — tapping a
// lift opens the calculator with that lift's canonical lb value, in either
// display unit, and never shows the Log entry's editable target field.
describe('AnalyticsStrengthSection — tapping a lift opens the fixed-target calculator', () => {
  test.each(['lb', 'kg'])('passes the canonical lb weight when displaying in %s', async (u) => {
    if (u === 'kg') setWeightUnitPreference('kg');
    const display = u === 'kg' ? { total: 408, squat: 136, bench: 113, deadlift: 159 } : oneK;
    let root;
    await act(async () => {
      root = renderer.create(
        <ThemeProvider>
          <AnalyticsStrengthSection
            handleStrengthLayout={() => {}}
            isNotesLoading={false}
            oneK={display}
            oneKCanonical={oneKCanonical}
            oneKChartData={[]}
          />
        </ThemeProvider>
      );
    });
    const { PlateCalculatorModal } = require('../components/PlateCalculatorModal');
    const modal = () => root.root.findByType(PlateCalculatorModal);
    expect(modal().props.visible).toBe(false);
    const squat = root.root.find((n) => typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Show plate loading for Squats') && typeof n.props.onPress === 'function');
    await act(async () => { squat.props.onPress(); });
    expect(modal().props.visible).toBe(true);
    expect(modal().props.weightLb).toBe(300);
    expect(modal().props.editableTarget).toBeFalsy();
    act(() => { root.unmount(); });
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
    expect(toggle.props.accessibilityLabel).toBe('What is 1K Progress?');
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    // Same row as the heading: the nearest ancestor holding the heading holds
    // nothing else from the card (not the 1K value below it).
    let row = toggle.parent;
    while (!texts(row).includes('1K Progress')) row = row.parent;
    expect(texts(row).some(t => t.includes('900'))).toBe(false);
    expect(texts(root.root)).not.toContain('How is this calculated?');
    expect(texts(root.root).some(t => t.includes('most recent complete Big 3 cycle'))).toBe(false);
    await act(async () => { toggle.props.onPress(); });
    // #1356: only what 1K is, its lifts, the one-session lag, and deloads.
    const body = texts(root.root.findAll(n => n.props.testID === 'onek-info-body')[0]);
    expect(body).toEqual([
      '1K is your estimated Squat + Bench + Deadlift one-rep max total, using the lifts in your Big 3 mapping.',
      'It totals your most recent complete Big 3 cycle, so a lift you trained more recently can read one session behind until the others catch up.',
      'Deload sessions appear on the graph as their own marked point, kept off the trend line.',
    ]);
  });
});

// #1246: Big 3 Mapping sits under the 1K panel. Progression suggestions moved to
// the Progressive Overload section, so Strength renders none.
describe('AnalyticsStrengthSection — Big 3 Mapping placement (#1246)', () => {
  test('renders the mapping slot after the 1K panel and no progression rows', async () => {
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
    expect(at('analytics-progression-suggestions')).toBe(-1);
  });
});
