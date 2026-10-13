// Weekly total-recovery trend (#1318): one bar per recovery week through the
// selected week, each the snapshot's as-of TOTAL recovery for that week (capped
// at 100, so bars use a fixed 0-100 scale). Weeks are ordinals, never dates. An unreadable
// week is a dashed "No data" gap, never a zero. The rows are also the week
// selector (#1307).

import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { InfoButton, InfoNote, useInfoExplainer } from '../InfoExplainer';
import { RECOVERY_WEEK_STATUS } from '../../lib/data/recoveryAnalytics';
import { STRENGTH_STATUS, displayPercent } from '../../lib/data/recoveryStrength';
import { createStrengthStyles } from './recoveryStrengthStyles';

export { strengthScaleMax } from '../../lib/data/recoverySnapshot';

export function StrengthBar({ percent, scaleMax, testID }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const width = `${Math.max(0, Math.min(100, (percent / scaleMax) * 100))}%`;
  const ref = `${(100 / scaleMax) * 100}%`;
  return (
    <View testID={testID} style={styles.track} accessible={false}>
      <View testID={testID ? `${testID}-fill` : undefined} style={[styles.fill, { width }]} />
      <View testID={testID ? `${testID}-reference` : undefined} style={[styles.reference, { left: ref, marginLeft: scaleMax === 100 ? -2 : -1 }]} />
    </View>
  );
}

// The scale legend is not printed (#1315); it is the bar-scale explainer beside
// "Week by week" (#1358). Two scales: week rows plot the capped total (always 0-100); lift bars share the ladder scale.
export const strengthScaleNote = (scaleMax) => `Week bars run 0–100% (total recovery is capped at 100%). Lift bars run 0–${scaleMax}%. The dark mark is your baseline (100%).`;

// The SOLE Analytics week selector (#1307). Membership is every live week of the
// block (comparison results, by stable week_id), so any week stays selectable:
// an unreadable or missing one reveals its explicit notice rather than being a
// silent no-op. The score comes from the as-of trend when it has the week; a week
// later than the selection (or a baseline with no strength data) says so.
export function RecoveryStrengthWeeks({ weekResults, strength, total, selectedWeekId, onSelect, scaleMax = 100 }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const [scaleShown, toggleScale] = useInfoExplainer();
  if (!weekResults || weekResults.length < 1) return null;
  const trend = new Map((total.trend || []).map(w => [w.week_id, w]));
  return (
    <View testID="recovery-strength-weeks" style={styles.section}>
      {/* One child of the gapped section, so the hidden note adds no space. */}
      <View>
        <View testID="recovery-weeks-title-row" style={styles.titleRow}>
          <Text style={styles.sectionTitle}>Week by week</Text>
          <InfoButton testID="recovery-scale-info-toggle" expanded={scaleShown} onPress={toggleScale} label="About the bar scale" />
        </View>
        <InfoNote shown={scaleShown} testID="recovery-scale-note">
          <Text style={styles.scaleNote}>{strengthScaleNote(scaleMax)}</Text>
        </InfoNote>
      </View>
      {weekResults.map(w => {
        const t = trend.get(w.week_id);
        const unreadable = w.status !== RECOVERY_WEEK_STATUS.OK || (t && !t.readable);
        const scored = !unreadable && t && t.percent != null;
        const valueText = scored ? `${displayPercent(t.percent)}%`
          : unreadable ? 'No data'
          : t ? 'No total'
          : strength.status === STRENGTH_STATUS.OK ? (total.reason ? 'No total' : 'Select to view') : 'Not scored';
        const selected = w.week_id === selectedWeekId;
        const label = `Week ${w.week_number}: ${scored ? `${valueText} total recovery` : unreadable ? 'no readable evidence' : valueText === 'No total' ? `no total${total.reason === 'no_scoreable_lifts' ? ', no baseline lift can be scored' : ''}` : valueText.toLowerCase()}`;
        return (
          <Pressable
            key={w.week_id}
            testID={`recovery-strength-week-${w.week_number}`}
            onPress={() => onSelect && onSelect(w.week_id)}
            style={[styles.weekRow, styles.weekRowPress, selected && styles.weekRowSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            accessibilityHint="Shows this week's evidence"
          >
            <Text style={[styles.weekLabel, selected && styles.weekLabelSelected]}>{`Week ${w.week_number}`}</Text>
            {scored ? (
              <StrengthBar percent={t.percent} scaleMax={100} testID={`recovery-strength-week-${w.week_number}-bar`} />
            ) : (
              <View style={styles.gapTrack} />
            )}
            <Text style={styles.weekValue}>{valueText}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
