import React from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SectionTitle } from '../../components/UI';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import { formatBodyweightValue } from '../../lib/units';
import { isGoalMet as computeIsGoalMet } from '../../lib/data/weightGoal';
import { createStyles, createHistoryPanel } from './weightStyles';

// Archived-goal history panel. Shares the one-panel visual system with Weight
// History (#411): the header row IS the column-header / summary row, with the
// collapse chevron in a trailing control cell and no separate empty chevron strip.
export function GoalHistoryPanel({ sortedArchivedGoals, collapsed, setCollapsed, latestArchivedOutcome, unit = 'lb' }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hp = useThemedStyles(createHistoryPanel);
  return (
    <View style={styles.archivedContainer}>
      <SectionTitle>Goal History</SectionTitle>
      <View style={hp.card}>
        <Pressable
          onPress={() => setCollapsed(c => !c)}
          style={[hp.headerRow, !collapsed && hp.headerRowBordered]}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expand goal history' : 'Collapse goal history'}
        >
          {collapsed ? (
            <View style={hp.headerContent}>
              <View style={hp.summaryStack}>
                <Text style={hp.summaryCount}>
                  {`${sortedArchivedGoals.length} ${sortedArchivedGoals.length === 1 ? 'goal' : 'goals'}`}
                </Text>
                <Text style={hp.summaryLatest} numberOfLines={1}>
                  {'Latest: '}
                  <Text
                    style={[
                      hp.summaryEmphasis,
                      latestArchivedOutcome?.met === true && styles.archivedValueMet,
                      latestArchivedOutcome?.met === false && styles.archivedValueMissed,
                    ]}
                  >
                    {latestArchivedOutcome?.label}
                  </Text>
                </Text>
              </View>
            </View>
          ) : (
            <View style={hp.headerContent}>
              <Text style={[hp.columnLabel, hp.col1]}>Target</Text>
              <Text style={[hp.columnLabel, hp.col2, hp.columnLabelCenter]}>End Weight</Text>
              <Text style={[hp.columnLabel, hp.col3, hp.columnLabelRight]}>Target Date</Text>
            </View>
          )}
          <View style={hp.controlCell}>
            <MaterialIcons
              name={collapsed ? 'expand-more' : 'expand-less'}
              size={18}
              color={colors.textMuted}
              accessible={false}
            />
          </View>
        </Pressable>
        {!collapsed && sortedArchivedGoals.map((g, index) => {
          const isLast = index === sortedArchivedGoals.length - 1;
          // Color End Weight by archived outcome: success when the completed
          // weight met the saved target, error when it did not, neutral when
          // no completed weight was recorded. Reuses the active-goal helper.
          const hasCompletedWeight =
            g.completed_weight !== null && g.completed_weight !== undefined;
          const rowArchivedRef = g.archived_at ? new Date(g.archived_at) : new Date();
          const endWeightOutcomeStyle = hasCompletedWeight
            ? (computeIsGoalMet(g, g.completed_weight, rowArchivedRef)
                ? styles.archivedValueMet
                : styles.archivedValueMissed)
            : null;
          return (
            <View key={g.id} style={[hp.rowContainer, isLast && hp.lastRow]}>
              <View style={hp.rowMain}>
                <View style={hp.rowCells}>
                  <View style={hp.col1}>
                    <Text style={hp.value}>{formatBodyweightValue(g.target_weight, unit)} {unit}</Text>
                  </View>
                  <View style={hp.col2}>
                    <Text style={[hp.value, endWeightOutcomeStyle]}>
                      {hasCompletedWeight ? `${formatBodyweightValue(g.completed_weight, unit)} ${unit}` : '—'}
                    </Text>
                  </View>
                  <View style={hp.col3}>
                    <Text style={hp.dateValue}>
                      {g.target_date ? formatDate(g.target_date) : '—'}
                    </Text>
                  </View>
                </View>
              </View>
              {/* Reserved trailing control cell keeps the three content
                  columns aligned with Weight History's rows (#411). */}
              <View style={hp.controlCellRow} />
            </View>
          );
        })}
      </View>
    </View>
  );
}
