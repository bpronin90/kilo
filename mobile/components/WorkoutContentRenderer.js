import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, AnnotationNote, UnparsedRow, NoteParseError, SET_ROW_FONT_SIZE } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { normalizeLiftName } from '../lib/data';
import { normalizeExerciseKey } from '../lib/parser';
import { useWeightUnit } from '../lib/unitPreference';
import { formatLiftWeightValue } from '../lib/units';
import { buildExerciseSourceAnchor } from '../lib/parser';
import { TYPOGRAPHY } from '../theme/typography';
import { LogDayHeading, LogBlockLabel, LogExerciseBlock, LogSetLine } from './log/LogExerciseRows';
import { ExerciseHistorySheet } from './log/ExerciseHistorySheet';

// #881 (F10a §5): the recognizer window for the exercise-name double-tap
// gesture that jumps to raw source. Deliberately separate from the note-body
// double-tap-to-edit gesture (useLogCurrentRoutineEditor's own 300ms window)
// — the two are wired to different Pressables and never compete for the same
// touch, but keeping the same window keeps the feel consistent.
const SOURCE_JUMP_DOUBLE_TAP_MS = 300;

// Compact set-line grouping (#843), mirroring UI.js's SetLine algorithm but
// rendered at Recovery's compact type scale (13/muted/600) instead of
// SetLine's own fixed SET_ROW_FONT_SIZE. Kept local to this file rather than
// adding a size prop to SetLine. Like SetLine (#1375), its weights are plain
// text; no note surface hosts a plate-calculator control.
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
  // #1606: 'log' opts the current-routine card into the redesign v3 Log
  // presentation (components/log/LogExerciseRows.js). Every other caller keeps
  // the default rendering. `onDayLayout(dayIndex, y)` reports each parsed day
  // group's offset for the sticky day index (log presentation only).
  presentation = 'default',
  onDayLayout = null,
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
  // #1606: the Log tab's opt-in presentation. Fold state is transient and
  // scoped to the exact note + A/B slice + parsed text that produced this
  // render, so a routine switch, week switch or saved edit drops every stale
  // expansion instead of re-targeting a different exercise occurrence.
  const logMode = presentation === 'log';
  const foldScope = `${sourceNoteId ?? ''}|${sourceWeekIndex}|${sourceSliceText ?? ''}`;
  const [fold, setFold] = useState({ scope: foldScope, keys: new Set() });
  const expandedKeys = fold.scope === foldScope ? fold.keys : null;
  const toggleFold = (key) => setFold((prev) => {
    const keys = new Set(prev.scope === foldScope ? prev.keys : []);
    if (keys.has(key)) keys.delete(key); else keys.add(key);
    return { scope: foldScope, keys };
  });
  // #1607: the open history sheet, keyed to this exact occurrence and scoped
  // like the fold state, so a routine/week/dataset change drops it.
  const [history, setHistory] = useState(null);
  const historyTarget = history && history.scope === foldScope ? history.target : null;
  // Running counter across every section in document order — matches
  // parseWorkoutNote's own `sections` index for the slice `dayGroups` was
  // built from, since buildDayGroups only ever groups adjacent same-heading
  // sections and never reorders or drops any (F10a §1's `sectionIndex`).
  let sectionCounter = 0;
  // A set row in the current presentation. `tone` is only used by the Log
  // presentation ('old' | 'last'); the default and compact paths ignore it.
  const renderRow = (key, sets, mark, tone) => (logMode ? (
    <LogSetLine key={key} sets={sets} unit={unit} mark={mark} tone={tone || 'old'} />
  ) : compact ? (
    <CompactSetLine key={key} sets={sets} unit={unit} styles={styles} mark={mark} />
  ) : (
    <SetLine key={key} sets={sets} selectable={true} mark={mark} />
  ));
  return (
    <>
      {noteError ? <NoteParseError message={noteError} /> : null}
      {dayGroups.map((group, gi) => (
        <View key={`day-${gi}`} onLayout={logMode && onDayLayout ? (e) => onDayLayout(gi, e.nativeEvent.layout.y) : undefined}>
          {/* Compact mode (#843) never repeats the day heading: the surface
              that hosts it already renders an uppercase day/section kicker
              of its own (LogRecoverySection.js's `noteSurfaceKicker`), so
              rendering it again here would show the same heading twice. */}
          {group.heading && !compact && (logMode ? (
            <LogDayHeading
              heading={group.heading}
              first={gi === 0}
              count={group.sections.reduce((n, sec) => n + sec.exercises.length, 0)}
            />
          ) : (
            <WorkoutHeading
              selectable={true}
              style={gi === 0 ? { marginTop: 0 } : null}
            >
              {group.heading}
            </WorkoutHeading>
          ))}
          {group.sections.map((section, si) => {
            const sectionIndex = sectionCounter++;
            return (
            <View key={`section-${gi}-${si}`}>
              {section.subheading && (logMode ? (
                <LogBlockLabel>{section.subheading}</LogBlockLabel>
              ) : (
                <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
              ))}
              {/* #854/G7c: nonblank lines with no open exercise are preserved
                  as section-level annotations rather than silently dropped. */}
              {(section.annotations || []).map((text, ai) => (
                <AnnotationNote key={`section-note-${gi}-${si}-${ai}`} text={text} selectable={true} />
              ))}
              {section.exercises.map((ex, ei) => {
                const exNormName = normalizeLiftName(ex.name);
                // #893/#892: `Tracked` reads the CANONICAL key the toggle now
                // writes, with the plain normalized name kept as a fallback so a
                // flag stored by an older build still lights its own pip. Without
                // this, tapping Track under one alias left the other alias's
                // heading showing `Track` for the same movement.
                const exCanonicalKey = normalizeExerciseKey(ex.name) || exNormName;
                const trackingEnabled = !isDeload && typeof onToggleTrack === 'function';
                const isTracked = !!(trackedLifts[exCanonicalKey] || trackedLifts[exNormName]);
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
                // Every rendered item for this occurrence, in the exact order
                // the default renderer has always used, grouped into units: a
                // logged session (its set line plus that entry's annotation
                // tail/comments), a skipped session, or a standalone unparsed
                // row. The default/compact paths flatten the units unchanged.
                const units = [];
                const unparsedMuted = mutedUnparsed || section.kind !== 'lifting';
                const unparsedUnit = (key, raw, error) => units.push({
                  key, session: false,
                  render: () => [<UnparsedRow selectable={true} key={key} raw={raw} error={error} muted={unparsedMuted} />],
                });
                const renderedUnparsed = new Set();
                const positions = ex.unparsed_positions || [];
                let posIdx = 0;
                let loggedIdx = 0;
                ex.session_entries.forEach((entry, eni) => {
                  while (posIdx < positions.length && positions[posIdx].pos === eni) {
                    unparsedUnit(`u-pos-${gi}-${si}-${ei}-${posIdx}`, positions[posIdx].raw, positions[posIdx].error);
                    posIdx++;
                  }
                  if (entry.skipped) {
                    const key = `skip-${gi}-${si}-${ei}-${eni}`;
                    units.push({ key, session: true, render: () => [<Text selectable={true} key={key} style={styles.skipMarker}>—</Text>] });
                  } else if (entry.unparsed) {
                    unparsedUnit(`u-inline-${gi}-${si}-${ei}-${eni}`, entry.raw, entry.error);
                    renderedUnparsed.add(entry.raw);
                  } else {
                    const row = ex.rows[loggedIdx++];
                    const annotation = entry.annotation;
                    const key = `row-${gi}-${si}-${ei}-${eni}`;
                    units.push({
                      key, session: true, row: !!row,
                      render: (tone) => {
                        const items = [];
                        if (row) items.push(renderRow(key, row.sets, annotation ? annotation.mark : null, tone));
                        if (annotation && annotation.tail) {
                          items.push(<AnnotationNote key={`tail-${gi}-${si}-${ei}-${eni}`} text={annotation.tail} selectable={true} />);
                        }
                        if (annotation && annotation.comments) {
                          annotation.comments.forEach((comment, ci) => {
                            items.push(<AnnotationNote key={`note-${gi}-${si}-${ei}-${eni}-${ci}`} text={comment} selectable={true} />);
                          });
                        }
                        return items;
                      },
                    });
                  }
                });
                while (posIdx < positions.length) {
                  unparsedUnit(`u-pos-${gi}-${si}-${ei}-${posIdx}`, positions[posIdx].raw, positions[posIdx].error);
                  posIdx++;
                }
                const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
                ex.rows.slice(loggedCount).forEach((row, ri) => {
                  const key = `plain-${gi}-${si}-${ei}-${ri}`;
                  units.push({ key, session: true, row: true, render: (tone) => [renderRow(key, row.sets, null, tone)] });
                });
                const positionalRaws = new Set(positions.map(p => p.raw));
                ex.unparsed_rows.forEach((u, ui) => {
                  if (!positionalRaws.has(u) && !renderedUnparsed.has(u) && !renderedUnparsed.has(u.replace(/^-\s+/, ''))) {
                    units.push({
                      key: `u-${gi}-${si}-${ei}-${ui}`, session: false,
                      render: () => [<UnparsedRow selectable={true} key={`u-${gi}-${si}-${ei}-${ui}`} raw={u} muted={unparsedMuted} />],
                    });
                  }
                });
                if (logMode) {
                  const foldKey = `${gi}-${si}-${ei}`;
                  return (
                    <View key={`ex-${gi}-${si}-${ei}`} style={isFlagged ? styles.flaggedExercise : null}>
                      <LogExerciseBlock
                        name={ex.name}
                        isTracked={isTracked}
                        onToggleTrack={trackingEnabled ? () => onToggleTrack(ex.name) : undefined}
                        onNamePress={onNamePress}
                        units={units}
                        expanded={!!expandedKeys && expandedKeys.has(foldKey)}
                        onToggleExpanded={() => toggleFold(foldKey)}
                        testID={`log-exercise-${foldKey}`}
                        lastTone={isDeload ? 'lead' : 'last'}
                        onOpenHistory={(returnRef) => setHistory({ scope: foldScope, target: { key: foldKey, exercise: ex, returnRef, context: [group.heading, section.subheading, altWeekText ? `Week ${sourceWeekIndex === 1 ? 'B' : 'A'}` : null].filter(Boolean) } })}
                      />
                    </View>
                  );
                }
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
                      {units.flatMap(u => u.render(null))}
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
      {logMode ? <ExerciseHistorySheet target={historyTarget} onClose={() => setHistory(null)} /> : null}
    </>
  );
}

// Under the production KUA gate (`kua` supplied) the compact reading scale,
// skip/empty ink, and flagged-exercise rail resolve through the selected court
// palette; outside the gate (`kua` null — isolated renderer tests) they keep
// the legacy palette. The workout section headers/TRACK states themselves come
// from the shared UI.js primitives, which stay on their own WorkoutKuaProvider
// opt-in (unchanged here).
const createStyles = (colors, kua = null) => StyleSheet.create({
  // Retained for the alt-week raw-text preview shown when the inactive A/B
  // week has no parsed content; unparsed set rows themselves now render via
  // the shared `UnparsedRow` component.
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: kua ? kua.onSurface : colors.text,
    paddingLeft: 0,
  },
  skipMarker: {
    fontSize: SET_ROW_FONT_SIZE,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  flaggedExercise: {
    borderLeftWidth: 3,
    borderLeftColor: kua ? kua.errorText : colors.error,
    marginLeft: -3,
  },
  // Recovery's compact type scale (#843): see the `compact` prop above.
  compactExerciseBlock: {
    marginBottom: 10,
    gap: 3,
  },
  compactExerciseName: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
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
    ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  compactSetReps: {
    ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  compactSetMark: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginLeft: 6,
  },
  emptyText: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 40,
  },
});
