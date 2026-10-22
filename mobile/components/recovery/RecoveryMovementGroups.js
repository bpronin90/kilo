// Movement-group breakdown for the Recovery strength view (#1306): one compact,
// collapsible list of flat rows. Each group shows the mean % of baseline
// strength over that group's part of the SAME comparable cohort as the headline
// (no percent, not 0%, when none of its lifts are scored), compact scored/cohort
// and baseline counts, and its exercises. The numbers are read-only; the group
// editor (MovementGroupEditor) lives in Log's Manage block (#1307, #1315). The
// list uses the shared collapsed disclosure; full count wording is in each row's
// accessibility label.

import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { displayPercent } from '../../lib/data/recoveryStrength';
import { RecoveryDisclosure } from './RecoveryStrengthDisclosures';
import { createMovementGroupStyles } from './recoveryMovementGroupStyles';
import { groupSourceText } from '../../lib/data/recoveryMovementGroups';

const _lifts = (n) => `${n} ${n === 1 ? 'lift' : 'lifts'}`;

export function groupCountsText(g) {
  const cohort = g.cohort_count > 0
    ? `${g.scored_count} of ${_lifts(g.cohort_count)} in the average scored`
    : 'No lift in the average';
  return `${cohort} · ${_lifts(g.baseline_count)} in the baseline`;
}

// The short line printed in the row; `groupCountsText` keeps the full meaning for
// the accessibility label.
export function groupCountsCompact(g) {
  return `${g.cohort_count > 0 ? `${g.scored_count} of ${g.cohort_count} scored` : 'None scored'} · ${g.baseline_count} in baseline`;
}

// One exercise: name and strength value on the first line, the status below. The
// value and bar are STRENGTH (% of baseline best set), never the work total.
function ExerciseRow({ ex, styles }) {
  const scored = ex.origin !== 'added' && ex.in_cohort && ex.percent != null;
  const pct = scored ? displayPercent(ex.percent) : null;
  const status = ex.origin === 'added' ? 'Added during recovery, not scored'
    : (ex.in_cohort ? (scored ? 'In the average' : 'In the average, no score this week') : 'Not in the average');
  const value = scored ? `${pct}%` : 'No score';
  const source = groupSourceText(ex);
  return (
    <View
      testID={`movement-group-exercise-${ex.key}`}
      style={styles.exercise}
      accessible
      accessibilityLabel={`${ex.name}: ${scored ? `${pct}% of baseline strength` : 'no score'}. ${status}. ${source}.`}
    >
      <View style={styles.exerciseHead}>
        <Text style={styles.exerciseName}>{ex.name}</Text>
        <Text testID={`movement-group-exercise-value-${ex.key}`} style={scored ? styles.exerciseValue : styles.exerciseValueEmpty}>{value}</Text>
      </View>
      {scored ? (
        <View style={styles.exerciseTrack}>
          <View style={[styles.exerciseFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
        </View>
      ) : null}
      <Text style={styles.exerciseMeta}>{`${status} · ${source}`}</Text>
    </View>
  );
}

function GroupRow({ group, styles, kua, colors }) {
  const [open, setOpen] = useState(false);
  const pct = group.percent == null ? null : displayPercent(group.percent);
  const counts = groupCountsText(group);
  const compact = groupCountsCompact(group);
  const valueText = pct == null ? 'No score' : `${pct}%`;
  return (
    <View testID={`movement-group-${group.id}`} style={styles.group}>
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
          <Text style={styles.caption}>{compact}</Text>
        </View>
        <Text testID={`movement-group-value-${group.id}`} style={pct == null ? styles.groupValueEmpty : styles.groupValue}>{valueText}</Text>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      {open ? (
        <View style={styles.exerciseList}>
          {group.exercises.map(ex => <ExerciseRow key={ex.key} ex={ex} styles={styles} />)}
        </View>
      ) : null}
    </View>
  );
}

export function RecoveryMovementGroups({ breakdown, notice = null, first = false }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createMovementGroupStyles(colors, kua), [colors, kua]);
  if (!breakdown || breakdown.groups.length === 0) return null;
  const n = breakdown.groups.length;
  const caption = `${_lifts(breakdown.total_count)} in ${n} ${n === 1 ? 'group' : 'groups'}${notice ? ' · saved choices unavailable' : ''}`;
  return (
    <RecoveryDisclosure
      testID="recovery-movement-groups"
      title="Movement groups"
      caption={caption}
      name="movement groups"
      a11yDetail={notice}
      first={first}
    >
      {notice ? <Text testID="movement-groups-notice" style={styles.notice}>{notice}</Text> : null}
      {breakdown.groups.map(g => (
        <GroupRow key={g.id} group={g} styles={styles} kua={kua} colors={colors} />
      ))}
    </RecoveryDisclosure>
  );
}
