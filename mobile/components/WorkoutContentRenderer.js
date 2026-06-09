import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, SET_ROW_FONT_SIZE } from './UI';
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
  emptyText = "Add some exercises to see the formatted view.",
  altWeekText = ""
}) {
  return (
    <>
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
                              <Text 
                                selectable={true} 
                                key={`u-pos-${gi}-${si}-${ei}-${posIdx}`} 
                                style={(!mutedUnparsed && section.kind === 'lifting') ? styles.unparsedRow : styles.unparsedRowMuted}
                              >
                                {positions[posIdx].raw}
                              </Text>
                            );
                            posIdx++;
                          }
                          if (entry.skipped) {
                            items.push(<Text selectable={true} key={`skip-${gi}-${si}-${ei}-${eni}`} style={styles.skipMarker}>—</Text>);
                          } else if (entry.unparsed) {
                            items.push(
                              <Text 
                                selectable={true} 
                                key={`u-inline-${gi}-${si}-${ei}-${eni}`} 
                                style={(!mutedUnparsed && section.kind === 'lifting') ? styles.unparsedRow : styles.unparsedRowMuted}
                              >
                                {entry.raw}
                              </Text>
                            );
                            renderedUnparsed.add(entry.raw);
                          } else {
                            const row = ex.rows[loggedIdx++];
                            if (row) items.push(<SetLine key={`row-${gi}-${si}-${ei}-${eni}`} sets={row.sets} selectable={true} />);
                          }
                        });
                        while (posIdx < positions.length) {
                          items.push(
                            <Text 
                              selectable={true} 
                              key={`u-pos-${gi}-${si}-${ei}-${posIdx}`} 
                              style={(!mutedUnparsed && section.kind === 'lifting') ? styles.unparsedRow : styles.unparsedRowMuted}
                            >
                              {positions[posIdx].raw}
                            </Text>
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
                              <Text 
                                selectable={true} 
                                key={`u-${gi}-${si}-${ei}-${ui}`} 
                                style={(!mutedUnparsed && section.kind === 'lifting') ? styles.unparsedRow : styles.unparsedRowMuted}
                              >
                                {u}
                              </Text>
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
      {!dayGroups.length && (
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
  unparsedRow: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.error,
    paddingLeft: 0,
  },
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
