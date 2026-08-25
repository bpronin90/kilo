import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, AnnotationNote, UnparsedRow, NoteParseError, SET_ROW_FONT_SIZE } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { normalizeLiftName } from '../lib/data';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';
import { buildExerciseSourceAnchor } from '../lib/parser';

// #881 (F10a §5): the recognizer window for the exercise-name double-tap
// gesture that jumps to raw source. Deliberately separate from the note-body
// double-tap-to-edit gesture (useLogCurrentRoutineEditor's own 300ms window)
// — the two are wired to different Pressables and never compete for the same
// touch, but keeping the same window keeps the feel consistent.
const SOURCE_JUMP_DOUBLE_TAP_MS = 300;

// Compact set-line grouping (#843), mirroring UI.js's SetLine algorithm but
// rendered at Recovery's compact type scale (13/muted/600) instead of
// SetLine's own fixed SET_ROW_FONT_SIZE. Kept local to this file rather than
// adding a size prop to SetLine — SetLine's own plate-calculator affordance
// is not part of the compact Recovery reading surface.
function CompactSetLine({ sets, unit, styles, mark }) {
  if (!sets || sets.length === 0) return null;
  const groups = [];
  let currentGroup = null;
  for (const set of sets) {
    // #852: mirrors SetLine's grouping in UI.js — see that component's
    // comment for why the group breaks on conversion identity, not just the
    // weight number.
    const convertedFromKg = !!set.converted_from_kg;
    const kgValue = set.kg_value ?? null;
    if (
      !currentGroup
      || currentGroup.weight !== set.weight_value
      || currentGroup.convertedFromKg !== convertedFromKg
      || currentGroup.kgValue !== kgValue
    ) {
      currentGroup = { weight: set.weight_value, reps: [], convertedFromKg, kgValue };
      groups.push(currentGroup);
    }
    // #854/G4: a duration set (header-declared, e.g. "3x30 sec") carries
    // duration_seconds instead of rep_count.
    currentGroup.reps.push(
      set.skipped ? '-' : (set.duration_seconds != null ? `${set.duration_seconds}s` : set.rep_count)
    );
  }
  return (
    <View style={styles.compactSetLine}>
      {groups.map((group, i) => (
        <View key={i} style={styles.compactSetGroup}>
          {/* #852: mirrors SetLine's single-string weight+suffix in UI.js —
              see that component's comment for why the "(40kg)" suffix is
              part of the same plain string rather than a separately styled
              nested Text. */}
          <Text
            style={styles.compactSetWeight}
            accessibilityLabel={
              group.weight && group.convertedFromKg
                ? `${formatLiftWeightValue(group.weight, unit)} ${unit}, converted from ${group.kgValue} kilograms`
                : undefined
            }
          >
            {group.weight
              ? (group.convertedFromKg
                ? `${formatLiftWeightValue(group.weight, unit)} ${unit} (${group.kgValue}kg)`
                : `${formatLiftWeightValue(group.weight, unit)} ${unit}`)
              : 'BW'}
          </Text>
          <Text style={styles.compactSetReps}>{group.reps.join(', ')}</Text>
        </View>
      ))}
      {mark ? (
        <Text style={styles.compactSetMark} accessibilityLabel={`Marked: ${mark}`}>{`★ ${mark}`}</Text>
      ) : null}
    </View>
  );
}

export function WorkoutContentRenderer({
  dayGroups,
  trackedLifts = {},
  onToggleTrack,
  roughNoteId,
  currentId,
  roughFlaggedNames = new Set(),
  isDeload = false,
  mutedUnparsed = false,
  noteError = null,
  emptyText = "Add some exercises to see the formatted view.",
  altWeekText = "",
  // Recovery's compact reading mode (#843): exercise names render at 14/700
  // and sets at 13/muted/600 instead of the routine-tab full scale, so a
  // note's content never competes with the card that hosts it. Routine
  // rendering (every other caller) is unaffected — this defaults to false.
  compact = false,
  // #881 (F10a/F10b): source-jump wiring. All four are optional — omitting
  // any of them (Deload views, or a surface not yet wired) simply means no
  // double-tap anchor is ever built and `onExercisePress` is never called,
  // so the gesture is a strict no-op there. `sourceSliceText` MUST be the
  // exact raw-text slice that was parsed to build `dayGroups`, since the
  // anchor's staleness gate is this exact string, captured verbatim.
  sourceNoteId = null,
  sourceWeekIndex = 0,
  sourceSliceText = null,
  onExercisePress = null,
}) {
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();
  const sourceJumpEnabled = sourceNoteId != null && sourceSliceText != null && typeof onExercisePress === 'function';
  // Manual double-tap detector (F10a §5): a plain onPress on a selectable
  // Text does not disturb native long-press/selection, so a single tap stays
  // a no-op exactly as before this feature existed. Keyed per rendered
  // exercise occurrence rather than per gesture instance, since this
  // component re-renders on every keystroke elsewhere on screen.
  const lastTapRef = useRef({});
  // #881 PR #883 review (P2): a screen reader's "double-tap to activate"
  // gesture is delivered to RN as a single onPress, so the two-press
  // detector below would consume it as only the first half of a jump and
  // never fire. While a screen reader is running, treat every activation
  // as the jump directly — the detector still gates ordinary touch input.
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
      if (mounted) setScreenReaderEnabled(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReaderEnabled);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  const handleNamePress = (key, anchor) => {
    if (!sourceJumpEnabled || !anchor) return;
    if (screenReaderEnabled) {
      onExercisePress(anchor);
      return;
    }
    const now = Date.now();
    const last = lastTapRef.current[key] || 0;
    if (now - last < SOURCE_JUMP_DOUBLE_TAP_MS) {
      lastTapRef.current[key] = 0;
      onExercisePress(anchor);
    } else {
      lastTapRef.current[key] = now;
    }
  };
  // Running counter across every section in document order — matches
  // parseWorkoutNote's own `sections` index for the slice `dayGroups` was
  // built from, since buildDayGroups only ever groups adjacent same-heading
  // sections and never reorders or drops any (F10a §1's `sectionIndex`).
  let sectionCounter = 0;
  return (
    <>
      {noteError ? <NoteParseError message={noteError} /> : null}
      {dayGroups.map((group, gi) => (
        <View key={`day-${gi}`}>
          {/* Compact mode (#843) never repeats the day heading: the surface
              that hosts it already renders an uppercase day/section kicker
              of its own (LogRecoverySection.js's `noteSurfaceKicker`), so
              rendering it again here would show the same heading twice. */}
          {group.heading && !compact && (
            <WorkoutHeading
              selectable={true}
              style={gi === 0 ? { marginTop: 0 } : null}
            >
              {group.heading}
            </WorkoutHeading>
          )}
          {group.sections.map((section, si) => {
            const sectionIndex = sectionCounter++;
            return (
            <View key={`section-${gi}-${si}`}>
              {section.subheading && (
                <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
              )}
              {/* #854/G7c: nonblank lines with no open exercise are preserved
                  as section-level annotations rather than silently dropped. */}
              {(section.annotations || []).map((text, ai) => (
                <AnnotationNote key={`section-note-${gi}-${si}-${ai}`} text={text} selectable={true} />
              ))}
              {section.exercises.map((ex, ei) => {
                const exNormName = normalizeLiftName(ex.name);
                const trackingEnabled = !isDeload && typeof onToggleTrack === 'function';
                const isTracked = !!trackedLifts[exNormName];
                const isFlagged = !isDeload && roughNoteId === currentId && roughFlaggedNames.has(exNormName);
                const ExerciseWrap = compact ? View : ExerciseBlock;
                // #881: built fresh per exercise occurrence from the exact
                // parse that produced this render — never from the exercise
                // name alone (F10a §1).
                const sourceAnchor = sourceJumpEnabled
                  ? buildExerciseSourceAnchor({
                    noteId: sourceNoteId,
                    weekIndex: sourceWeekIndex,
                    sliceText: sourceSliceText,
                    sectionIndex,
                    exerciseOrdinal: ei,
                    exercise: ex,
                  })
                  : null;
                const namePressKey = `${gi}-${si}-${ei}`;
                const onNamePress = sourceAnchor ? () => handleNamePress(namePressKey, sourceAnchor) : undefined;
                const exerciseWrapProps = compact
                  ? { style: styles.compactExerciseBlock }
                  : {
                    name: ex.name,
                    isTracked: trackingEnabled ? isTracked : undefined,
                    onToggleTrack: trackingEnabled ? () => onToggleTrack(ex.name) : undefined,
                    selectable: true,
                    onNamePress,
                  };
                return (
                  <View key={`ex-${gi}-${si}-${ei}`} style={isFlagged ? styles.flaggedExercise : null}>
                    <ExerciseWrap {...exerciseWrapProps}>
                      {compact && (
                        <Text
                          selectable={true}
                          style={styles.compactExerciseName}
                          onPress={onNamePress}
                        >
                          {ex.name}
                        </Text>
                      )}
                      {(() => {
                        const items = [];
                        const renderedUnparsed = new Set();
                        const positions = ex.unparsed_positions || [];
                        let posIdx = 0;
                        let loggedIdx = 0;
                        ex.session_entries.forEach((entry, eni) => {
                          while (posIdx < positions.length && positions[posIdx].pos === eni) {
                            items.push(
                              <UnparsedRow
                                selectable={true}
                                key={`u-pos-${gi}-${si}-${ei}-${posIdx}`}
                                raw={positions[posIdx].raw}
                                error={positions[posIdx].error}
                                muted={mutedUnparsed || section.kind !== 'lifting'}
                              />
                            );
                            posIdx++;
                          }
                          if (entry.skipped) {
                            items.push(<Text selectable={true} key={`skip-${gi}-${si}-${ei}-${eni}`} style={styles.skipMarker}>—</Text>);
                          } else if (entry.unparsed) {
                            items.push(
                              <UnparsedRow
                                selectable={true}
                                key={`u-inline-${gi}-${si}-${ei}-${eni}`}
                                raw={entry.raw}
                                error={entry.error}
                                muted={mutedUnparsed || section.kind !== 'lifting'}
                              />
                            );
                            renderedUnparsed.add(entry.raw);
                          } else {
                            const row = ex.rows[loggedIdx++];
                            const annotation = entry.annotation;
                            if (row) {
                              items.push(
                                compact ? (
                                  <CompactSetLine
                                    key={`row-${gi}-${si}-${ei}-${eni}`}
                                    sets={row.sets}
                                    unit={unit}
                                    styles={styles}
                                    mark={annotation ? annotation.mark : null}
                                  />
                                ) : (
                                  <SetLine
                                    key={`row-${gi}-${si}-${ei}-${eni}`}
                                    sets={row.sets}
                                    selectable={true}
                                    mark={annotation ? annotation.mark : null}
                                  />
                                )
                              );
                            }
                            if (annotation && annotation.tail) {
                              items.push(
                                <AnnotationNote
                                  key={`tail-${gi}-${si}-${ei}-${eni}`}
                                  text={annotation.tail}
                                  selectable={true}
                                />
                              );
                            }
                            if (annotation && annotation.comments) {
                              annotation.comments.forEach((comment, ci) => {
                                items.push(
                                  <AnnotationNote
                                    key={`note-${gi}-${si}-${ei}-${eni}-${ci}`}
                                    text={comment}
                                    selectable={true}
                                  />
                                );
                              });
                            }
                          }
                        });
                        while (posIdx < positions.length) {
                          items.push(
                            <UnparsedRow
                              selectable={true}
                              key={`u-pos-${gi}-${si}-${ei}-${posIdx}`}
                              raw={positions[posIdx].raw}
                              error={positions[posIdx].error}
                              muted={mutedUnparsed || section.kind !== 'lifting'}
                            />
                          );
                          posIdx++;
                        }
                        const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
                        ex.rows.slice(loggedCount).forEach((row, ri) => {
                          items.push(
                            compact ? (
                              <CompactSetLine key={`plain-${gi}-${si}-${ei}-${ri}`} sets={row.sets} unit={unit} styles={styles} />
                            ) : (
                              <SetLine key={`plain-${gi}-${si}-${ei}-${ri}`} sets={row.sets} selectable={true} />
                            )
                          );
                        });
                        const positionalRaws = new Set(positions.map(p => p.raw));
                        ex.unparsed_rows.forEach((u, ui) => {
                          if (!positionalRaws.has(u) && !renderedUnparsed.has(u) && !renderedUnparsed.has(u.replace(/^-\s+/, ''))) {
                            items.push(
                              <UnparsedRow
                                selectable={true}
                                key={`u-${gi}-${si}-${ei}-${ui}`}
                                raw={u}
                                muted={mutedUnparsed || section.kind !== 'lifting'}
                              />
                            );
                          }
                        });
                        return items;
                      })()}
                    </ExerciseWrap>
                  </View>
                );
              })}
            </View>
            );
          })}
        </View>
      ))}
      {!dayGroups.length && !noteError && (
        altWeekText ? (
          <Text selectable={true} style={styles.unparsedRowMuted}>{altWeekText}</Text>
        ) : (
          <Text selectable={true} style={styles.emptyText}>{emptyText}</Text>
        )
      )}
    </>
  );
}

const createStyles = (colors) => StyleSheet.create({
  // Retained for the alt-week raw-text preview shown when the inactive A/B
  // week has no parsed content; unparsed set rows themselves now render via
  // the shared `UnparsedRow` component.
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: colors.text,
    paddingLeft: 0,
  },
  skipMarker: {
    fontSize: SET_ROW_FONT_SIZE,
    color: colors.textMuted,
  },
  flaggedExercise: {
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    marginLeft: -3,
  },
  // Recovery's compact type scale (#843): see the `compact` prop above.
  compactExerciseBlock: {
    marginBottom: 10,
    gap: 3,
  },
  compactExerciseName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  compactSetLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  compactSetGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  compactSetWeight: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  compactSetReps: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  compactSetMark: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginLeft: 6,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 40,
  },
});
