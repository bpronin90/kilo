import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Panel } from '../../components/ui/RedesignPrimitives';
import { useTheme } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { formatDate } from '../../lib/format';
import { formatBodyweightValue, formatGoalWeightValue } from '../../lib/units';
import { isGoalMet as computeIsGoalMet } from '../../lib/data/weightGoal';
import { createStyles, createHistoryPanel } from './weightStyles';

// Archived-goal history (Redesign v3, #1601): the last panel on Weight, a
// disclosure "Goal history · N" whose summary keeps the latest outcome. Open,
// it shows the existing Target / End Weight / Target Date table with the same
// column grid as Weight History, End Weight colored by archived outcome.
export function GoalHistoryPanel({ sortedArchivedGoals, collapsed, setCollapsed, latestArchivedOutcome, unit = 'lb' }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  const hp = useMemo(() => createHistoryPanel(colors, kua, typo), [colors, kua, typo]);
  const mutedInk = kua ? kua.onSurfaceVariant : colors.textMuted;
  const count = sortedArchivedGoals.length;
  return (
    <Panel testID="weight-goal-history">
      <Pressable
        onPress={() => setCollapsed(c => !c)}
        style={({ pressed }) => [styles.disclosureRow, pressed ? styles.disclosurePressed : null]}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? 'Expand goal history' : 'Collapse goal history'}
        accessibilityState={{ expanded: !collapsed }}
        aria-expanded={!collapsed}
      >
        <MaterialIcons name="history" size={20} color={mutedInk} accessible={false} />
        <View style={styles.disclosureText}>
          <Text style={styles.disclosureTitle}>{`Goal history · ${count}`}</Text>
          {latestArchivedOutcome ? (
            <Text style={styles.disclosureSummary} numberOfLines={1}>
              {'Latest: '}
              <Text
                style={[
                  styles.disclosureEmphasis,
                  latestArchivedOutcome.met === true && styles.archivedValueMet,
                  latestArchivedOutcome.met === false && styles.archivedValueMissed,
                ]}
              >
                {latestArchivedOutcome.label}
              </Text>
            </Text>
          ) : null}
        </View>
        <MaterialIcons name={collapsed ? 'expand-more' : 'expand-less'} size={20} color={mutedInk} accessible={false} />
      </Pressable>
      {!collapsed ? (
        <>
          <View style={hp.columnsRow}>
            <Text style={[hp.columnLabel, hp.col1]}>Target</Text>
            <Text style={[hp.columnLabel, hp.col2]}>End Weight</Text>
            <Text style={[hp.columnLabel, hp.col3]}>Target Date</Text>
            <View style={hp.control} />
          </View>
          {sortedArchivedGoals.map((g) => {
            // Success when the completed weight met the saved target, error when
            // it did not, neutral when no completed weight was recorded. Judged
            // against the goal's own archived_at so the outcome stays stable.
            const hasCompletedWeight =
              g.completed_weight !== null && g.completed_weight !== undefined;
            const rowArchivedRef = g.archived_at ? new Date(g.archived_at) : new Date();
            const endWeightOutcomeStyle = hasCompletedWeight
              ? (computeIsGoalMet(g, g.completed_weight, rowArchivedRef)
                  ? styles.archivedValueMet
                  : styles.archivedValueMissed)
              : null;
            return (
              <View key={g.id} style={hp.row}>
                <Text style={[hp.value, hp.col1]}>{formatGoalWeightValue(g.target_weight, unit)} {unit}</Text>
                <Text style={[hp.value, hp.col2, endWeightOutcomeStyle]}>
                  {hasCompletedWeight ? `${formatBodyweightValue(g.completed_weight, unit)} ${unit}` : 'N/A'}
                </Text>
                <Text style={[hp.dateValue, hp.col3]}>
                  {g.target_date ? formatDate(g.target_date) : 'N/A'}
                </Text>
                <View style={hp.control} />
              </View>
            );
          })}
        </>
      ) : null}
    </Panel>
  );
}
