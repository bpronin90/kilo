import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, AnnotationNote, UnparsedRow, NoteParseError, SET_ROW_FONT_SIZE } from './UI';
import { Colors } from '../theme/colors';
import { normalizeLiftName } from '../lib/data';

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
  altWeekText = ""
}) {
  return (
    <>
      {noteError ? <NoteParseError message={noteError} /> : null}
      {dayGroups.map((group, gi) => (
        <View key={`day-${gi}`}>
          {group.heading && (
            <WorkoutHeading 
              selectable={true}
              style={gi === 0 ? { marginTop: 0 } : null}
            >
              {group.heading}
            </WorkoutHeading>
          )}
          {group.sections.map((section, si) => (
            <View key={`section-${gi}-${si}`}>
              {section.subheading && (
                <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
              )}
              {section.exercises.map((ex, ei) => {
                const exNormName = normalizeLiftName(ex.name);
                const trackingEnabled = !isDeload && typeof onToggleTrack === 'function';
                const isTracked = !!trackedLifts[exNormName];
                const isFlagged = !isDeload && roughNoteId === currentId && roughFlaggedNames.has(exNormName);
                return (
                  <View key={`ex-${gi}-${si}-${ei}`} style={isFlagged ? styles.flaggedExercise : null}>
                    <ExerciseBlock
                      name={ex.name}
                      isTracked={trackingEnabled ? isTracked : undefined}
                      onToggleTrack={trackingEnabled ? () => onToggleTrack(ex.name) : undefined}
                      selectable={true}
                    >
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
                                <SetLine
                                  key={`row-${gi}-${si}-${ei}-${eni}`}
                                  sets={row.sets}
                                  selectable={true}
                                  mark={annotation ? annotation.mark : null}
                                />
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
                          items.push(<SetLine key={`plain-${gi}-${si}-${ei}-${ri}`} sets={row.sets} selectable={true} />);
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
                    </ExerciseBlock>
                  </View>
                );
              })}
            </View>
          ))}
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

const styles = StyleSheet.create({
  // Retained for the alt-week raw-text preview shown when the inactive A/B
  // week has no parsed content; unparsed set rows themselves now render via
  // the shared `UnparsedRow` component.
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.text,
    paddingLeft: 0,
  },
  skipMarker: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.textMuted,
  },
  flaggedExercise: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
    marginLeft: -3,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 40,
  },
});
