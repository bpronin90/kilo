// Movement-group breakdown for the Recovery strength view (#1306): one compact,
// collapsible list of flat rows. Each group shows the mean % of baseline
// strength over that group's part of the SAME comparable cohort as the headline
// (no percent, not 0%, when none of its lifts are scored), the scored/cohort and
// baseline counts, and its exercises. The numbers are read-only; the group editor
// (MovementGroupEditor) lives in Manage block (#1307).

import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { displayPercent } from '../../lib/data/recoveryStrength';
import { createMovementGroupStyles } from './recoveryMovementGroupStyles';

const _lifts = (n) => `${n} ${n === 1 ? 'lift' : 'lifts'}`;

export function groupCountsText(g) {
  const cohort = g.cohort_count > 0
    ? `${g.scored_count} of ${_lifts(g.cohort_count)} in the average scored`
    : 'No lift in the average';
  return `${cohort} · ${_lifts(g.baseline_count)} in the baseline`;
}

function GroupRow({ group, styles, kua, colors }) {
  const [open, setOpen] = useState(false);
  const pct = group.percent == null ? null : displayPercent(group.percent);
  const counts = groupCountsText(group);
  const valueText = pct == null ? 'No score' : `${pct}%`;
  return (
    <View testID={`movement-group-${group.id}`}>
      <Pressable
        testID={`movement-group-row-${group.id}`}
        onPress={() => setOpen(o => !o)}
        style={styles.groupRow}
        accessibilityRole="button"
        accessibilityLabel={`${group.label}: ${pct == null ? 'no score' : `${pct}% of baseline strength`}. ${counts}.`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.groupMain}>
          <Text style={styles.groupName}>{group.label}</Text>
          <Text style={styles.caption}>{counts}</Text>
        </View>
        <Text testID={`movement-group-value-${group.id}`} style={pct == null ? styles.groupValueEmpty : styles.groupValue}>{valueText}</Text>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      {open ? (
        <View style={styles.exerciseList}>
          {group.exercises.map(ex => (
            <View key={ex.key} testID={`movement-group-exercise-${ex.key}`} style={styles.exercise}>
              <View style={styles.exerciseHead}>
                <Text style={styles.exerciseName}>{ex.name}</Text>
              </View>
              <Text style={styles.exerciseMeta}>
                {[
                  ex.source === 'override' ? 'Your choice' : 'Automatic',
                  ex.origin === 'added' ? 'added during recovery, not scored' : (ex.in_cohort ? (ex.percent == null ? 'in the average, no score this week' : `${displayPercent(ex.percent)}% of baseline`) : 'not in the average'),
                ].join(' · ')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function RecoveryMovementGroups({ breakdown, notice = null }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createMovementGroupStyles(colors, kua), [colors, kua]);
  const [expanded, setExpanded] = useState(false);
  if (!breakdown || breakdown.groups.length === 0) return null;
  return (
    <View testID="recovery-movement-groups" style={styles.panel}>
      <Pressable
        testID="recovery-movement-groups-header"
        onPress={() => setExpanded(e => !e)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse movement groups' : 'Expand movement groups'}
        accessibilityState={{ expanded }}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>Movement groups</Text>
          <Text style={styles.caption}>{`${_lifts(breakdown.total_count)} in ${breakdown.groups.length} ${breakdown.groups.length === 1 ? 'group' : 'groups'}`}</Text>
        </View>
        <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      {expanded ? (
        <>
          {notice ? <Text testID="movement-groups-notice" style={styles.notice}>{notice}</Text> : null}
          {breakdown.groups.map(g => (
            <GroupRow key={g.id} group={g} styles={styles} kua={kua} colors={colors} />
          ))}
        </>
      ) : null}
    </View>
  );
}
