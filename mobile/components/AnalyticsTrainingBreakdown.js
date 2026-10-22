import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SectionTitle } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { createTrainingBreakdownStyles } from '../screens/analytics/trainingBreakdownStyles';
import { deriveTrainingBreakdownForRange } from '../lib/data/trainingBreakdown';
import { resolveBreakdownPalette } from './trainingBreakdown/breakdownPalette';
import { MetricsHeader, RangeSelector, ViewTabs } from './trainingBreakdown/BreakdownHeader';
import { EquipmentView, MovementView, MusclesView } from './trainingBreakdown/BreakdownViews';
import { BreakdownSheet } from './trainingBreakdown/BreakdownSheet';
import { resolveSheet } from './trainingBreakdown/sheetContent';

// Training breakdown dashboard (#1588, replacing the #1580 lists). The session
// window (#1597: Last 4 / Last 12 / All, default Last 12, in memory only) and
// every drill-down live in this tree and affect this section only. Data comes
// solely from deriveTrainingBreakdownForRange over the verified Recovery-filtered
// population; a null result (unverified population, unusable pairing) shows the
// unavailable state, never an empty or unfiltered breakdown. Windows are
// positional, so nothing here depends on the clock.
export const DEFAULT_TRAINING_BREAKDOWN_RANGE = 'last12';

const EMPTY_COPY = {
  last4: 'No completed sets in the last 4 sessions of any exercise.',
  last12: 'No completed sets in the last 12 sessions of any exercise.',
  All: 'No completed sets in eligible history yet. Log a working set to see it here.',
};

export function AnalyticsTrainingBreakdown({
  parsedSections = null, populationVerified = false, isLoading = false, hasError = false, paused = false, onLayout,
}) {
  const { colors, kuaPalette: kua, mode } = useTheme();
  const p = useMemo(() => resolveBreakdownPalette(colors, kua, mode), [colors, kua, mode]);
  const styles = useMemo(() => createTrainingBreakdownStyles(colors, kua, mode), [colors, kua, mode]);
  const [range, setRange] = useState(DEFAULT_TRAINING_BREAKDOWN_RANGE);
  const [view, setView] = useState('movement');
  const [stack, setStack] = useState([]);

  const breakdown = useMemo(
    () => (isLoading || hasError ? null : deriveTrainingBreakdownForRange(parsedSections, range, { populationVerified: populationVerified === true })),
    [parsedSections, range, populationVerified, isLoading, hasError],
  );

  const onOpen = useCallback((desc, push = false) => setStack((s) => (push ? [...s, desc] : [desc])), []);
  const onBack = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const onClose = useCallback(() => setStack([]), []);
  const sheet = resolveSheet(stack[stack.length - 1], { styles, p, breakdown, range, onOpen });

  const placeholder = (testID, text, spinner = false) => (
    <View testID={testID} style={styles.placeholder}>
      {spinner ? <ActivityIndicator size="small" color={p.primary} /> : null}
      <Text style={styles.placeholderText}>{text}</Text>
    </View>
  );

  const changeRange = (r) => { setRange(r); setStack([]); };
  let content;
  if (isLoading) content = placeholder('training-breakdown-loading', 'Reading your training history…', true);
  else if (hasError) content = placeholder('training-breakdown-error', 'Workout notes could not be read, so the training breakdown is unavailable.');
  else if (!breakdown) content = placeholder('training-breakdown-unavailable', 'The training breakdown is unavailable until your history can be verified.');
  else {
    content = (
      <>
        {breakdown.isEmpty ? placeholder('training-breakdown-empty', EMPTY_COPY[range]) : (
          <>
            <MetricsHeader styles={styles} totals={breakdown.totals} timed={breakdown.timed} onTimed={() => onOpen({ kind: 'timed' })} />
            <ViewTabs styles={styles} view={view} onChange={setView} onInfo={() => onOpen({ kind: 'info' })} />
            {view === 'muscles' ? <MusclesView styles={styles} p={p} breakdown={breakdown} onOpen={onOpen} /> : null}
            {view === 'equipment' ? <EquipmentView styles={styles} p={p} breakdown={breakdown} onOpen={onOpen} /> : null}
            {view === 'movement' ? <MovementView styles={styles} p={p} breakdown={breakdown} onOpen={onOpen} /> : null}
          </>
        )}
      </>
    );
  }

  return (
    <View testID="training-breakdown-section" onLayout={onLayout} style={styles.section}>
      <View style={styles.titleRow}>
        <SectionTitle>Training breakdown</SectionTitle>
        {breakdown ? <RangeSelector styles={styles} range={range} onChange={changeRange} /> : null}
      </View>
      {paused ? <Text testID="training-breakdown-paused" style={styles.paused}>Paused during Recovery · baseline history</Text> : null}
      {content}
      <BreakdownSheet styles={styles} sheet={sheet} stackDepth={stack.length} onBack={onBack} onClose={onClose} />
    </View>
  );
}
