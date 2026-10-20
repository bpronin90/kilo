// The ONE collapsed-by-default disclosure used by every per-exercise Recovery
// list (#1315): lifts, movement groups, not retested, not scored for strength.
// A >=44dp header row with a counted title, an optional caption and a
// MaterialIcons chevron; the body mounts only while open. The caller keys the
// group by block + week so every disclosure resets to collapsed on a change.

import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { LIFT_STATE, NOT_RETESTED, UNSCOREABLE_REASON } from '../../lib/data/recoveryStrength';
import { createStrengthStyles } from './recoveryStrengthStyles';

export function RecoveryDisclosure({ testID, title, caption = null, name, first = false, children, a11yDetail = null }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const [open, setOpen] = useState(false);
  return (
    <View testID={testID} style={[styles.disc, first && styles.discFirst]}>
      <Pressable
        testID={`${testID}-header`}
        onPress={() => setOpen(o => !o)}
        style={styles.discHeader}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${name}${a11yDetail ? `. ${a11yDetail}` : ''}`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.discText}>
          <Text style={styles.discTitle}>{title}</Text>
          {caption ? <Text style={styles.infoLine}>{caption}</Text> : null}
        </View>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
      </Pressable>
      {open ? <View style={styles.discBody}>{children}</View> : null}
    </View>
  );
}

// Group entries sharing one reason under one heading, then list every exercise
// on its own line, in the original order. Nothing is joined into a paragraph or
// truncated (#1442, #1537).
function groupByReason(entries, reasonOf) {
  const groups = new Map();
  for (const e of entries) {
    const reason = reasonOf(e);
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(e);
  }
  return [...groups].map(([reason, items]) => ({ reason, items }));
}

const _count = (n) => `${n} ${n === 1 ? 'lift' : 'lifts'}`;

// One reason: a heading naming the reason and its count, then a list of one
// compact line per exercise. The list is announced as a list with its reason.
function ReasonGroup({ id, reason, items, styles }) {
  return (
    <View testID={`recovery-reason-${id}`} style={styles.reasonGroup} accessibilityRole="list" accessibilityLabel={`${reason}: ${_count(items.length)}`}>
      <Text testID={`recovery-reason-heading-${id}`} accessibilityRole="header" style={styles.reasonHeading}>{`${reason} · ${_count(items.length)}`}</Text>
      {items.map((e, i) => (
        <Text key={`${e.key || e.name}:${i}`} testID={`recovery-reason-item-${e.key || e.name}`} style={styles.reasonItem}>{e.name}</Text>
      ))}
    </View>
  );
}

const NOT_RETESTED_COPY = Object.freeze({
  [NOT_RETESTED.ABSENT_THIS_WEEK]: 'Not logged this week',
  [NOT_RETESTED.NEVER_LOGGED]: 'Not logged in any week yet',
  [NOT_RETESTED.UNKNOWN]: 'Not in any readable week',
});

// Baseline exercises with no completed entry in the selected week.
export function NotRetestedDisclosure({ strength, first = false }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const list = strength.not_retested || [];
  if (list.length === 0) return null;
  return (
    <RecoveryDisclosure testID="recovery-strength-not-retested" title={`${list.length} not retested`} name={`${list.length} not retested lifts`} first={first}>
      {groupByReason(list, n => NOT_RETESTED_COPY[n.kind]).map(g => (
        <ReasonGroup key={g.reason} id={`retest-${g.items[0].kind}`} reason={g.reason} items={g.items} styles={styles} />
      ))}
    </RecoveryDisclosure>
  );
}

// Every identity with no strength score: baseline rows that can never be scored
// plus lifts that are unscoreable in the selected week, de-duplicated by key.
export function notScoredEntries(strength) {
  const seen = new Set();
  const out = [];
  const add = (key, name, reasonKey) => {
    if (seen.has(key)) return;
    seen.add(key);
    const known = UNSCOREABLE_REASON[reasonKey] ? reasonKey : 'no_scoreable_set';
    out.push({ key, name, reason: UNSCOREABLE_REASON[known], reasonKey: known });
  };
  for (const l of strength.lifts || []) if (l.state === LIFT_STATE.UNSCOREABLE) add(l.key, l.name, l.reason);
  for (const n of strength.not_scored || []) add(n.key, n.name, n.reason);
  return out;
}

export function NotScoredDisclosure({ strength, first = false }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const list = notScoredEntries(strength);
  if (list.length === 0) return null;
  return (
    <RecoveryDisclosure testID="recovery-strength-not-scored" title={`${list.length} not scored for strength`} name={`${list.length} lifts not scored for strength`} first={first}>
      {groupByReason(list, n => n.reason).map(g => (
        <ReasonGroup key={g.reason} id={`unscored-${g.items[0].reasonKey}`} reason={g.reason} items={g.items} styles={styles} />
      ))}
    </RecoveryDisclosure>
  );
}
