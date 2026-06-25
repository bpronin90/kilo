import React, { useState, useRef } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Button, SectionTitle } from './UI';
import { Colors } from '../theme/colors';
import { localDate, DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';

export function LogDeloadSection({
  deloadNote,
  deloadLoading,
  deloadDayGroups,
  enterDeloadEditor,
  handleDeloadBodyPress,
  deloadMode,
  completeDeload,
  handleGenerateDeload,
  isGenerating,
  workoutNoteText,
  saveError,
  deloadNotes,
  deloadHistory,
  deleteDeloadNote,
  deleteDeload,
  viewingNoteId,
  handleViewOtherNote,
  viewingNote,
  viewingNoteDayGroups,
  handleOpenOtherNote,
  logSessionCount,
}) {
  const [deloadCollapsed, setDeloadCollapsed] = useState(false);
  const [expandedDeloads, setExpandedDeloads] = useState(new Set());
  const [showDeloadOrdinalPrompt, setShowDeloadOrdinalPrompt] = useState(false);
  const [deloadOrdinalInput, setDeloadOrdinalInput] = useState('');

  const handleDeloadCollapsedToggle = () => {
    setDeloadCollapsed(c => !c);
  };

  const handleToggleLegacyDeload = (id) => {
    setExpandedDeloads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCompleteDeload = () => {
    setDeloadOrdinalInput(String(logSessionCount));
    setShowDeloadOrdinalPrompt(true);
  };

  const handleConfirmDeloadOrdinal = async () => {
    const ordinal = parseInt(deloadOrdinalInput, 10);
    if (!ordinal || ordinal < 1) return;
    setShowDeloadOrdinalPrompt(false);
    await completeDeload({ sessionCount: logSessionCount, deloadSessionOrdinal: ordinal });
  };

  // Double-tap the viewed past-deload body to open it in the editor (matches main).
  const viewingNoteLastTapRef = useRef(0);
  const handleViewedNoteBodyPress = (note) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - viewingNoteLastTapRef.current < DOUBLE_TAP_DELAY) {
      handleOpenOtherNote(note);
      viewingNoteLastTapRef.current = 0;
    } else {
      viewingNoteLastTapRef.current = now;
    }
  };

  if (deloadLoading) {
    return null;
  }

  return (
    <>
      {saveError ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{saveError}</Text>
        </Card>
      ) : null}

      {!deloadNote?.raw_text ? (
        <View style={styles.deloadEmpty}>
          <Text style={styles.deloadEmptyText}>No deload week generated yet.</Text>
          <Button
            onPress={handleGenerateDeload}
            title="Generate deload"
            disabled={isGenerating || !workoutNoteText.trim()}
          />
        </View>
      ) : (
        <>
          <View style={styles.mirrorContainer}>
            <Card style={styles.currentRoutineCard}>
              <Pressable onPress={handleDeloadCollapsedToggle} style={styles.otherNoteHeader}>
                <View style={styles.otherNoteInfo}>
                  <Text style={styles.currentNoteTitle}>Deload Week</Text>
                  {deloadNote?.saved_at && (
                    <Text style={styles.otherNoteSub}>{localDate(deloadNote.saved_at).toLocaleDateString()}</Text>
                  )}
                </View>
                <Pressable
                  onPress={(e) => { e.stopPropagation(); enterDeloadEditor(); }}
                  style={styles.inlineSwitchButton}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                >
                  <Text style={styles.inlineSwitchButtonText}>Edit</Text>
                </Pressable>
              </Pressable>
              <Pressable
                onPress={handleDeloadBodyPress}
                style={[styles.currentNoteContent, deloadCollapsed ? { display: 'none' } : null]}
              >
                <Text style={styles.editHint}>Double-tap to edit</Text>
                <WorkoutContentRenderer
                  dayGroups={deloadDayGroups}
                  isDeload={true}
                  mutedUnparsed={true}
                  emptyText="Deload note is empty."
                />
              </Pressable>
            </Card>
          </View>
          <View style={styles.previousRoutines}>
            {deloadMode === 'read' && (
              <Button
                onPress={handleCompleteDeload}
                title="Deload complete"
              />
            )}
            <Button
              onPress={handleGenerateDeload}
              title={isGenerating ? 'Generating…' : 'Regenerate deload'}
              disabled={isGenerating || !workoutNoteText.trim()}
              style={styles.generateButton}
              textStyle={styles.generateButtonText}
            />
          </View>
        </>
      )}

      {(deloadNotes.length > 0 || deloadHistory.some(r => !r.note_id)) && (
        <View style={styles.pastDeloads}>
          <SectionTitle>Past deloads</SectionTitle>
          {[
            ...deloadNotes.map(n => ({ type: 'note', id: n.id, sortKey: n.saved_at, data: n })),
            ...deloadHistory.filter(r => !r.note_id).map(r => ({ type: 'legacy', id: r.id, sortKey: r.completed_at, data: r })),
          ].sort((a, b) => b.sortKey.localeCompare(a.sortKey)).map(item => {
            if (item.type === 'note') {
              const note = item.data;
              const rawDate = note.title.startsWith(DELOAD_NOTE_PREFIX)
                ? note.title.slice(DELOAD_NOTE_PREFIX.length)
                : note.saved_at.slice(0, 10);
              const dateStr = rawDate ? localDate(rawDate).toLocaleDateString() : '';
              return (
                <Card key={note.id} style={styles.otherNoteCard}>
                  <Pressable onPress={() => handleViewOtherNote(note)} style={styles.otherNoteHeader}>
                    <View style={styles.otherNoteInfo}>
                      <Text style={styles.otherNoteTitle}>{note.title}</Text>
                      <Text style={styles.otherNoteSub}>Completed {dateStr}</Text>
                    </View>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        Alert.alert(
                          'Delete deload record?',
                          'This cannot be undone. The sessions-since-deload clock will reset based on your remaining history.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => deleteDeloadNote(note.id) },
                          ]
                        );
                      }}
                      style={styles.inlineSwitchButton}
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                    >
                      <Text style={styles.pastDeloadDeleteText}>Delete</Text>
                    </Pressable>
                  </Pressable>
                  {viewingNoteId === note.id && viewingNote && (
                    <>
                      <Pressable onPress={() => handleViewedNoteBodyPress(note)} style={styles.currentNoteContent}>
                        <Text style={styles.editHint}>Double-tap to edit</Text>
                        <WorkoutContentRenderer
                          dayGroups={viewingNoteDayGroups}
                          isDeload={true}
                          emptyText="Deload note is empty."
                        />
                      </Pressable>
                      <View style={styles.inlineActions}>
                        <Button
                          onPress={() => handleOpenOtherNote(note)}
                          title="Edit deload record"
                          style={styles.switchButton}
                          textStyle={styles.switchButtonText}
                        />
                      </View>
                    </>
                  )}
                </Card>
              );
            }
            const record = item.data;
            const isExpanded = expandedDeloads.has(record.id);
            const dateStr = localDate(record.completed_at).toLocaleDateString();
            const generatedStr = record.generated_at ? localDate(record.generated_at).toLocaleDateString() : null;
            const title = generatedStr && generatedStr !== dateStr
              ? `Deload ${generatedStr}`
              : `Deload ${dateStr}`;
            return (
              <Card key={record.id} style={styles.otherNoteCard}>
                <Pressable
                  onPress={() => handleToggleLegacyDeload(record.id)}
                  style={styles.otherNoteHeader}
                >
                  <View style={styles.otherNoteInfo}>
                    <Text style={styles.otherNoteTitle}>{title}</Text>
                    <Text style={styles.otherNoteSub}>Completed {dateStr}</Text>
                  </View>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      Alert.alert(
                        'Delete deload record?',
                        'This cannot be undone. The sessions-since-deload clock will reset based on your remaining history.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => deleteDeload(record.id) },
                        ]
                      );
                    }}
                    style={styles.inlineSwitchButton}
                    hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                  >
                    <Text style={styles.pastDeloadDeleteText}>Delete</Text>
                  </Pressable>
                </Pressable>
                {isExpanded && (
                  <Text selectable style={styles.pastDeloadContent}>{record.raw_text}</Text>
                )}
              </Card>
            );
          })}
        </View>
      )}

      <Modal
        visible={showDeloadOrdinalPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeloadOrdinalPrompt(false)}
      >
        <View style={styles.ordinalOverlay}>
          <View style={styles.ordinalSheet}>
            <Text style={styles.ordinalTitle}>Which session number is this deload?</Text>
            <Text style={styles.ordinalSubtitle}>
              Prefilled from your current note. Edit if your real session count differs.
            </Text>
            <TextInput
              style={styles.ordinalInput}
              value={deloadOrdinalInput}
              onChangeText={setDeloadOrdinalInput}
              keyboardType="number-pad"
              selectTextOnFocus
              autoFocus
            />
            <View style={styles.ordinalButtons}>
              <Pressable
                style={styles.ordinalCancel}
                onPress={() => setShowDeloadOrdinalPrompt(false)}
              >
                <Text style={styles.ordinalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.ordinalConfirm}
                onPress={handleConfirmDeloadOrdinal}
              >
                <Text style={styles.ordinalConfirmText}>Deload complete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  errorText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    borderColor: Colors.error,
    backgroundColor: '#fff0f0',
    padding: 12,
    marginBottom: 8,
  },
  mirrorContainer: {
    paddingBottom: 2,
  },
  currentRoutineCard: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: Colors.cardBorder,
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
  },
  otherNoteInfo: {
    flex: 1,
  },
  otherNoteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  currentNoteTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.accent,
  },
  otherNoteSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  editHint: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.chipBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  previousRoutines: {
    marginTop: 4,
    gap: 12,
  },
  generateButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  generateButtonText: {
    color: Colors.accent,
  },
  deloadEmpty: {
    marginTop: 40,
    alignItems: 'center',
    gap: 16,
  },
  deloadEmptyText: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  pastDeloads: {
    marginTop: 8,
    gap: 8,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  pastDeloadDeleteText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  pastDeloadContent: {
    fontSize: 13,
    color: Colors.text,
    fontFamily: 'monospace',
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  inlineActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  switchButtonText: {
    color: Colors.accent,
  },
  ordinalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(31,26,23,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ordinalSheet: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 24,
    gap: 12,
  },
  ordinalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  ordinalSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  ordinalInput: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  ordinalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  ordinalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.chipBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  ordinalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  ordinalConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.accent,
  },
  ordinalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
