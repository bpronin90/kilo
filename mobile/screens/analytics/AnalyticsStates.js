import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { OverloadRow, OverloadColumnHeader, describePoRowState } from './OverloadRows';

// Re-exported: the row caption lives with the row presentation (#1604).
export { describePoRowState };

// The Progressive Overload list's own loading / populated / empty-search /
// empty-tracked states (#821, #737), rendered inside the Progressive Overload
// section (AnalyticsProgressiveOverload.js).
export function renderOverloadListContent({
  isNotesLoading,
  isTrackedLoading,
  groupedSignals,
  collapsedGroups,
  toggleGroup,
  analytics,
  unit,
  colors,
  kua = null,
  styles,
  searchQuery,
  statusFilterActive = false,
  onNavigate,
  onOpenExercise,
  registerRow,
}) {
  if (isNotesLoading || isTrackedLoading) {
    return (
      <View key="loading" style={{ height: 100, justifyContent: 'center' }}>
        <ActivityIndicator color={kua ? kua.primary : colors.accent} />
      </View>
    );
  }

  if (groupedSignals.length > 0) {
    return (
      <View key="po-container" testID="po-container">
        <OverloadColumnHeader styles={styles} />
        {groupedSignals.map((group) => {
          const isCollapsed = collapsedGroups.has(group.name);
          const rows = group.exercises || [];
          return (
            <View key={group.name} style={styles.groupSection}>
              <Pressable
                testID={`po-group-header-${group.name}`}
                onPress={() => toggleGroup(group.name)}
                style={styles.groupHeader}
                accessibilityRole="button"
                accessibilityState={{ expanded: !isCollapsed }}
                accessibilityLabel={`${group.name}, ${rows.length} ${rows.length === 1 ? 'exercise' : 'exercises'}`}
              >
                <Text style={styles.groupName} accessible={false}>
                  {group.name}
                  <Text style={styles.groupCount}>{` · ${rows.length}`}</Text>
                </Text>
                <MaterialIcons
                  name={isCollapsed ? "expand-more" : "expand-less"}
                  size={20}
                  color={kua ? kua.onSurfaceVariant : colors.textMuted}
                  accessible={false}
                />
              </Pressable>

              {!isCollapsed && rows.map(sig => (
                <OverloadRow
                  key={sig.name + sig.currentDayHeading}
                  sig={sig}
                  analytics={analytics}
                  unit={unit}
                  styles={styles}
                  colors={colors}
                  kua={kua}
                  onOpen={onOpenExercise}
                  rowRef={registerRow ? registerRow(sig) : undefined}
                />
              ))}
            </View>
          );
        })}
      </View>
    );
  }

  if (searchQuery || statusFilterActive) {
    return (
      <View key="empty-search" style={styles.emptySearch}>
        <Text style={styles.emptyText}>
          {searchQuery ? `No matches for "${searchQuery}"` : 'No exercises match this filter'}
        </Text>
      </View>
    );
  }

  return (
    <View key="empty-tracked" style={styles.emptyTracked}>
      <Text style={styles.emptyText}>
        No tracked exercises yet.{'\n'}Track an exercise in Log to see it here.
      </Text>
      <Pressable
        testID="analytics-empty-log-link"
        onPress={() => onNavigate?.('Log')}
        style={styles.emptyTrackedLink}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go to Log"
        accessibilityHint="Opens the Log tab so you can write a workout note"
      >
        <Text style={styles.emptyTrackedLinkText}>Go to Log</Text>
      </Pressable>
    </View>
  );
}
