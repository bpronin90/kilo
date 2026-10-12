import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Card } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';
import { DELOAD_NOTE_PREFIX } from '../../lib/LogScreenHelpers';

// Small chevron affordance shared by every quiet handoff on this card.
function Chevron({ color }) {
  return (
    <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

// Info glyph for the classification caption toggle. Replaces the "ⓘ" text
// character, which is absent from the bundled Space Grotesk / JetBrains Mono
// faces and rendered as a tofu box on device (#1112).
function InfoIcon({ color }) {
  return (
    <Svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Circle cx="12" cy="12" r="9" />
      <Line x1="12" y1="11" x2="12" y2="16" />
      <Circle cx="12" cy="7.5" r="0.6" fill={color} stroke={color} />
    </Svg>
  );
}

// `Exercise Progress` is the same Analytics handoff in every hero state (#1333):
// the trio below it is the summary, Progressive Overload is the detail.
function ExerciseProgressLink({ linkId, onNavigate, styles, color }) {
  return (
    <Pressable
      testID={linkId}
      onPress={() => onNavigate('Analytics', 'progressive-overload')}
      style={[styles.sectionHeaderAction, styles.sectionHeaderActionStart]}
      hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel="Exercise Progress"
      accessibilityHint="Opens the Progressive Overload section of the Analytics tab"
    >
      <Text style={[styles.classifSectionLabel, styles.sectionHeaderLabel]}>Exercise Progress</Text>
      <View style={styles.sectionHeaderChevron}>
        <Chevron color={color} />
      </View>
    </Pressable>
  );
}

// Tier 1 training hero, extracted from HomeScreen (#1049). Presentation only:
// every value it renders is computed by HomeScreen and passed in.
//
// #1333: the hero answers three questions and nothing else — what is being
// trained (week + routine), how it is going (Exercise Progress), and what to do
// next (the two daily-loop actions). Body weight lives in its own card below.
// #1339: in Recovery the Recovery card owns the week and its Big 3, so the hero
// is only `Recovery` and the next action — no week, note, or paused handoff.
export function HomeHeader({
  dashboardData,
  onNavigate,
  isRecoveryOpenWeek,
  isRecoveryBetweenWeeks,
  baselinePaused,
  workoutNote,
  notes,
  handleLogWorkoutPress,
  heroPrimaryActionLabel,
  heroPrimaryActionHint,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const [captionExpanded, setCaptionExpanded] = useState(false);

  const isRecovery = isRecoveryOpenWeek || isRecoveryBetweenWeeks;
  // No current routine, or one with nothing written in it yet, is not a
  // training week: no `Week N/A`, no 0·0·0 trio, just the way back in (#1333).
  const hasRoutineContent = !!workoutNote?.raw_text?.trim();
  // Deload notes never appear in Log's routine list, so they are not a routine
  // the user can choose (same predicate as LogScreenStates' otherNotes).
  const hasSavedRoutines = (notes || []).some(n => n && !n.title?.startsWith(DELOAD_NOTE_PREFIX));
  const routineState = isRecovery ? 'recovery'
    : !workoutNote ? 'none'
    : !hasRoutineContent ? 'empty'
    : 'active';
  const headerLabel = routineState === 'recovery' ? 'Recovery'
    : routineState === 'none' ? 'No current routine'
    : dashboardData.weeksIn !== null ? `Week ${dashboardData.weeksIn}` : 'Current routine';
  const routineTitle = routineState === 'active' || routineState === 'empty'
    ? (workoutNote.title || '').trim() || null
    : null;
  const routineMessage = routineState === 'none'
    ? (hasSavedRoutines ? 'Pick a saved routine or write a new one in Log.' : 'Write a routine in Log to track your weeks.')
    : routineState === 'empty'
      ? 'Add exercises to this routine in Log to track progress.'
      : null;
  const primaryLabel = routineState === 'none'
    ? (hasSavedRoutines ? 'Choose routine' : 'Write routine')
    : heroPrimaryActionLabel;
  const primaryHint = routineState === 'none'
    ? 'Opens the Log tab to pick or write a routine'
    : heroPrimaryActionHint;

  const mutedStroke = kua ? kua.onSurfaceVariant : colors.textMuted;
  const actionStroke = kua ? kua.primaryOnContainer : colors.textMuted;

  const newlyTrackedCount = dashboardData.weeklySummary.newlyTrackedCount;
  const captionText = newlyTrackedCount > 0
    ? (newlyTrackedCount === 1
        ? '1 exercise in its first tracked session. Log another to see a trend'
        : `${newlyTrackedCount} exercises in their first tracked session. Log another to see a trend`)
    : dashboardData.weeklySummary.hasInheritedTracking
      ? 'Includes exercises tracked before this update, using full history'
      : null;

  return (
    <Card style={styles.weeklyHero}>
      {/* What is being trained: the week identity, then which routine it is. */}
      <View style={styles.heroHeaderRow}>
        <View style={styles.heroAccentBar} />
        <Text testID="home-hero-label" style={styles.heroSectionLabel} numberOfLines={1}>{headerLabel}</Text>
      </View>

      {routineTitle ? (
        <Text testID="home-routine-title" style={styles.heroRecoveryNoteLabel} numberOfLines={1}>{routineTitle}</Text>
      ) : null}

      {/* How it is going. */}
      {routineMessage ? (
        <Text testID="home-no-routine" style={styles.heroRoutineMessage}>{routineMessage}</Text>
      ) : baselinePaused ? null : (
        // Paused baseline (#869) has no counts to show; #1339 drops the bare
        // handoff that stood in for them.
        <View style={styles.classifSection}>
          <View style={styles.classifHeaderRow}>
            <ExerciseProgressLink linkId="home-exercise-progress-link" onNavigate={onNavigate} styles={styles} color={mutedStroke} />
            {captionText && kua ? (
              <Pressable
                testID="home-classif-info"
                onPress={() => setCaptionExpanded(v => !v)}
                style={styles.heroInfoToggle}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityState={{ expanded: captionExpanded }}
                accessibilityLabel={captionText}
              >
                <InfoIcon color={mutedStroke} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.classifRow}>
            {[
              { label: 'Progressing', count: dashboardData.weeklySummary.classifications?.progressing ?? 0, color: kua ? kua.success : colors.success },
              { label: 'Steady', count: dashboardData.weeklySummary.classifications?.stalled ?? 0, color: kua ? kua.warning : colors.caution },
              { label: 'Regressing', count: dashboardData.weeklySummary.classifications?.regressing ?? 0, color: kua ? kua.errorText : colors.error },
            ].map((item, idx) => (
              <View key={idx} style={styles.classifCol}>
                <Text style={[styles.classifCount, kua ? { color: item.color } : null]}>{item.count}</Text>
                <Text style={styles.classifLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          {/* #894: the counts only cover a fully classified tracked span; the
              caption explains a 0/0/0 row. KUA reveals it from the info icon;
              legacy mode shows it plainly. */}
          {captionText && (!kua || captionExpanded) ? (
            <Text style={styles.classifCaption}>{captionText}</Text>
          ) : null}
        </View>
      )}

      {/* What to do next: the two daily-loop actions, in one stable row. */}
      <View style={styles.heroPrimaryActions}>
        <Pressable
          testID="home-current-routine-link"
          onPress={handleLogWorkoutPress}
          style={styles.heroPrimaryAction}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityHint={primaryHint}
        >
          <Text style={styles.heroPrimaryActionText}>{primaryLabel}</Text>
          <Chevron color={actionStroke} />
        </Pressable>

        <View style={styles.heroPrimaryActionDivider} />

        <Pressable
          testID="home-weight-action"
          onPress={() => onNavigate('Weight')}
          style={styles.heroPrimaryAction}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel="Log weight"
          accessibilityHint="Opens the Weight tab to log a weigh-in"
        >
          <Text style={styles.heroPrimaryActionText}>Log weight</Text>
          <Chevron color={actionStroke} />
        </Pressable>
      </View>
    </Card>
  );
}
