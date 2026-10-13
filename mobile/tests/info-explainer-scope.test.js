// #1356: every info icon outside Recovery sits beside the one thing it
// explains and reveals only that thing's meaning.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ThemeProvider } from '../theme/ThemeContext';
import { HomeHeader } from '../screens/home/HomeHeader';
import { AnalyticsProgressiveOverloadSection } from '../screens/analytics/AnalyticsProgressiveOverload';
import { createStyles as createAnalyticsStyles } from '../screens/analytics/analyticsStyles';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

// Icon glyphs (private-use code points, when the real icon font renders) are
// not readable text.
const texts = (node) => node.findAll(n => n.type === 'Text')
  .map(n => [].concat(n.props.children).join(''))
  .filter(t => t && !/^[\uE000-\uF8FF]+$/.test(t));
const button = (root, testID) => root.findAll(n => n.props.testID === testID && n.props.accessibilityRole === 'button')[0];
// The nearest ancestor of `node` whose text includes `label`.
const rowWith = (node, label) => {
  let row = node.parent;
  while (row && !texts(row).includes(label)) row = row.parent;
  return row;
};

async function mount(element) {
  let root;
  await act(async () => { root = renderer.create(<ThemeProvider>{element}</ThemeProvider>); });
  return root;
}

describe('Home — Exercise Progress explainer (#1356)', () => {
  const header = (weeklySummary) => (
    <HomeHeader
      dashboardData={{
        weeksIn: 3,
        weeklySummary: { classifications: { progressing: 0, stalled: 0, regressing: 0 }, ...weeklySummary },
      }}
      onNavigate={jest.fn()}
      workoutNote={{ id: 'n1', title: 'Routine A', raw_text: 'Monday\n1. bench press' }}
      notes={[]}
      handleLogWorkoutPress={jest.fn()}
      heroPrimaryActionLabel="Log workout"
      heroPrimaryActionHint="Opens Log"
    />
  );

  test('the shared info icon sits beside Exercise Progress and explains a first tracked session on request', async () => {
    const root = await mount(header({ newlyTrackedCount: 1, hasInheritedTracking: false }));
    const toggle = button(root.root, 'home-classif-info');
    expect(toggle.props.accessibilityLabel).toBe('About these Exercise Progress counts');
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    expect(toggle.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ minWidth: 44, minHeight: 44 })]));
    // Beside the label: the row holding the icon and the label holds no counts.
    expect(texts(rowWith(toggle, 'Exercise Progress'))).toEqual(['Exercise Progress']);
    const caption = '1 exercise is in its first tracked session. Log it again to see a trend.';
    expect(texts(root.root)).not.toContain(caption);
    await act(async () => { toggle.props.onPress(); });
    expect(button(root.root, 'home-classif-info').props.accessibilityState).toEqual({ expanded: true });
    const body = root.root.findAll(n => n.props.testID === 'home-classif-info-body')[0];
    expect(texts(body)).toEqual([caption]);
  });

  test('inherited tracking reads in plain language, not "tracked before this update"', async () => {
    const root = await mount(header({ newlyTrackedCount: 0, hasInheritedTracking: true }));
    await act(async () => { button(root.root, 'home-classif-info').props.onPress(); });
    const all = texts(root.root);
    expect(all).toContain('Some exercises use their existing workout history for these counts.');
    expect(all.some(t => t.includes('before this update'))).toBe(false);
    expect(all.some(t => /Track tap|Deload|1RM/.test(t))).toBe(false);
  });

  test('no unusual state, no info icon', async () => {
    const root = await mount(header({ newlyTrackedCount: 0, hasInheritedTracking: false }));
    expect(button(root.root, 'home-classif-info')).toBeUndefined();
  });
});

describe('Analytics — Progressive Overload has two scoped explainers (#1356)', () => {
  function section() {
    const Host = () => {
      const { useTheme } = require('../theme/ThemeContext');
      const { colors, kuaPalette } = useTheme();
      const styles = createAnalyticsStyles(colors, kuaPalette);
      return (
        <AnalyticsProgressiveOverloadSection
          styles={styles}
          colors={colors}
          kua={kuaPalette}
          isNotesLoading={false}
          isTrackedLoading={false}
          analytics={{
            exerciseProgress: { progressing: 2, stalled: 1, regressing: 0, classified: 3, newlyTracked: 0 },
            signals: [{ name: 'Bench Press' }],
          }}
          progressionSuggestionView={{ visible: [], muted: [] }}
          groupedSignals={[{ name: 'Monday', items: [] }]}
          toggleAllGroups={jest.fn()}
          allGroupsCollapsed={false}
          collapsedGroups={new Set(['Monday'])}
          toggleGroup={jest.fn()}
          searchQuery=""
          setSearchQuery={jest.fn()}
          unit="lb"
          onNavigate={jest.fn()}
        />
      );
    };
    return mount(<Host />);
  }

  test('Exercise Progress and Metrics each anchor their own icon and reveal only their own topic', async () => {
    const root = await section();
    expect(root.root.findAll(n => n.props.testID === 'po-info-toggle')).toHaveLength(0);

    const progress = button(root.root, 'po-progress-info-toggle');
    const metrics = button(root.root, 'po-metrics-info-toggle');
    expect(texts(rowWith(progress, 'Exercise Progress'))).toEqual(['Exercise Progress']);
    expect(texts(rowWith(metrics, 'Metrics'))).toEqual(['Metrics']);
    // Exercise Progress icon precedes the Progressing / Steady / Regressing
    // counts; Metrics precedes the 1RM / Kilo / Best column labels.
    const all = texts(root.root);
    expect(all.indexOf('Exercise Progress')).toBeLessThan(all.indexOf('Progressing'));
    expect(all.indexOf('Metrics')).toBeLessThan(all.indexOf('1RM'));

    const progressBody = () => texts(root.root.findAll(n => n.props.testID === 'po-progress-info-body')[0]);
    const metricsBody = () => texts(root.root.findAll(n => n.props.testID === 'po-metrics-info-body')[0]);
    expect(progressBody()).toEqual([]);
    expect(metricsBody()).toEqual([]);

    await act(async () => { metrics.props.onPress(); });
    expect(metricsBody()).toEqual([
      '1RM: your estimated one-rep max.',
      "Kilo: Kilo's estimate of your strength from your logged history.",
      'Best: your latest top set.',
      'Trend: the Exercise Progress state shown above.',
    ]);
    // Every visible column (1RM · Kilo · Best · Trend) is covered (#1358).
    expect(metrics.props.accessibilityLabel).toBe('What 1RM, Kilo, Best, and Trend mean');
    // Opening Metrics never reveals tracking-span rules.
    expect(progressBody()).toEqual([]);
    expect(texts(root.root).some(t => /Track|first tracked|Deload/.test(t) && !t.startsWith('Search'))).toBe(false);

    await act(async () => { progress.props.onPress(); });
    const body = progressBody().join(' ');
    expect(body).toContain('Progressing, Steady, and Regressing');
    expect(body).toContain('first tracked session needs another logged session');
    expect(body).toContain('Tapping Track starts tracking from that session');
    expect(body).toContain('uses its earlier history');
    expect(body).toContain("Deload sessions don't count toward progression.");
    // No metric definitions in the Exercise Progress explainer.
    expect(body).not.toMatch(/1RM|one-rep max|top set/);
  });
});
