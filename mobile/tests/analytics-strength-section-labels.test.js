import React from 'react';
import renderer, { act } from 'react-test-renderer';
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
