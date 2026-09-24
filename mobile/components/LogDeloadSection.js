import React, { useState, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Alert } from '../lib/platformAlert';
import { Card, Button, SectionTitle } from './UI';
import { useTheme, useThemedStyles, useKuaStyle } from '../theme/ThemeContext';
import { localDate, DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import { WorkoutContentRenderer } from './WorkoutContentRenderer';
import { MODAL_SUPPORTED_ORIENTATIONS, dialogWidthStyle } from './adaptiveLayout';

export function LogDeloadSection({
  deloadNote,
  deloadLoading,
  deloadDayGroups,
  enterDeloadEditor,
  handleDeloadBodyPress,
  deloadMode,
  completeDeload,
  clearDeloadNote,
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
  // Controlled by LogScreen (#775), for the same reason More Routines'
  // disclosure is: this section unmounts on every Routine↔Deload switch, so
  // local collapse state silently reset the card the user had just collapsed.
  deloadCollapsed = false,
  onToggleDeloadCollapsed,
}) {
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const styles = useThemedStyles(createStyles);
  const [expandedDeloads, setExpandedDeloads] = useState(new Set());
  const [showDeloadOrdinalPrompt, setShowDeloadOrdinalPrompt] = useState(false);
  const [deloadOrdinalInput, setDeloadOrdinalInput] = useState('');

  const handleDeloadCollapsedToggle = () => {
    onToggleDeloadCollapsed?.();
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

  const handleDeleteActiveDeload = () => {
    Alert.alert(
      'Delete active deload?',
      'This will remove the active deload and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: clearDeloadNote },
      ]
    );
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
              <Pressable
                onPress={handleDeloadCollapsedToggle}
                style={styles.otherNoteHeader}
                accessibilityRole="button"
                accessibilityLabel={deloadCollapsed ? 'Expand deload week' : 'Collapse deload week'}
                accessibilityState={{ expanded: !deloadCollapsed }}
              >
                <View style={styles.otherNoteInfo}>
                  <Text style={styles.currentNoteTitle}>Deload Week</Text>
                  {deloadNote?.saved_at && (
                    <Text style={styles.otherNoteSub}>{localDate(deloadNote.saved_at).toLocaleDateString()}</Text>
                  )}
                </View>
                <MaterialIcons
                  name={deloadCollapsed ? 'expand-more' : 'expand-less'}
                  size={18}
                  color={kua ? kua.onSurfaceVariant : colors.textMuted}
                  accessible={false}
                />
              </Pressable>
              {!deloadCollapsed && (
                <View style={styles.currentNoteContent}>
                  <Pressable onPress={handleDeloadBodyPress}>
                    <Text style={styles.editHint}>Double-tap to edit</Text>
                    <WorkoutContentRenderer
                      dayGroups={deloadDayGroups}
                      isDeload={true}
                      mutedUnparsed={true}
                      emptyText="Deload note is empty."
                    />
                  </Pressable>
                  <View style={styles.inlineActions}>
                    <Button
                      onPress={enterDeloadEditor}
                      title="Edit"
                      style={styles.switchButton}
                      textStyle={styles.switchButtonText}
                    />
                    {deloadMode === 'read' && (
                      <>
                        <Button
                          onPress={handleCompleteDeload}
                          title="Deload complete"
                        />
                        <Button
                          onPress={handleDeleteActiveDeload}
                          title="Delete active deload"
                          tone="danger"
                        />
                      </>
                    )}
                    <Button
                      onPress={handleGenerateDeload}
                      title={isGenerating ? 'Generating…' : 'Regenerate deload'}
                      disabled={isGenerating || !workoutNoteText.trim()}
                      style={styles.generateButton}
                      textStyle={styles.generateButtonText}
                    />
                  </View>
                </View>
              )}
            </Card>
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
              const isViewed = viewingNoteId === note.id;
              return (
                <Card key={note.id} style={styles.otherNoteCard}>
                  <Pressable
                    onPress={() => handleViewOtherNote(note)}
                    style={styles.otherNoteHeader}
                    accessibilityRole="button"
                    accessibilityLabel={isViewed ? `Collapse ${note.title}` : `Expand ${note.title}`}
                    accessibilityState={{ expanded: isViewed }}
                  >
                    <View style={styles.otherNoteInfo}>
                      <Text style={styles.otherNoteTitle}>{note.title}</Text>
                      <Text style={styles.otherNoteSub}>Completed {dateStr}</Text>
                    </View>
                    <MaterialIcons
                      name={isViewed ? 'expand-less' : 'expand-more'}
                      size={18}
                      color={kua ? kua.onSurfaceVariant : colors.textMuted}
                      accessible={false}
                    />
                  </Pressable>
                  {isViewed && viewingNote && (
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
                        <Button
                          onPress={() => {
                            Alert.alert(
                              'Delete deload record?',
                              'This cannot be undone. The sessions-since-deload clock will reset based on your remaining history.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Delete', style: 'destructive', onPress: () => deleteDeloadNote(note.id) },
                              ]
                            );
                          }}
                          title="Delete"
                          accessibilityLabel={`Delete ${note.title}`}
                          tone="danger"
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
                  accessibilityRole="button"
                  accessibilityLabel={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
                  accessibilityState={{ expanded: isExpanded }}
                >
                  <View style={styles.otherNoteInfo}>
                    <Text style={styles.otherNoteTitle}>{title}</Text>
                    <Text style={styles.otherNoteSub}>Completed {dateStr}</Text>
                  </View>
                  <MaterialIcons
                    name={isExpanded ? 'expand-less' : 'expand-more'}
                    size={18}
                    color={kua ? kua.onSurfaceVariant : colors.textMuted}
                    accessible={false}
                  />
                </Pressable>
                {isExpanded && (
                  <>
                    <Text selectable style={styles.pastDeloadContent}>{record.raw_text}</Text>
                    <View style={styles.inlineActions}>
                      <Button
                        onPress={() => {
                          Alert.alert(
                            'Delete deload record?',
                            'This cannot be undone. The sessions-since-deload clock will reset based on your remaining history.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => deleteDeload(record.id) },
                            ]
                          );
                        }}
                        title="Delete"
                        accessibilityLabel={`Delete ${title}`}
                        tone="danger"
                      />
                    </View>
                  </>
                )}
              </Card>
            );
          })}
        </View>
      )}

      <Modal
        visible={showDeloadOrdinalPrompt}
        transparent
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
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
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              accessibilityLabel="Deload session number"
            />
            <View style={styles.ordinalButtons}>
              <Pressable
                style={styles.ordinalCancel}
                onPress={() => setShowDeloadOrdinalPrompt(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.ordinalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.ordinalConfirm}
                onPress={handleConfirmDeloadOrdinal}
                accessibilityRole="button"
                accessibilityLabel="Confirm deload complete"
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

// Fade a KUA hex token to a low-opacity fill for the error card surface, so
// the tint reads on any court canvas. Mirrors backup/backupStyles.js. Only used
// on the KUA path.
function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Under the production KUA gate (`kua` supplied) the deload cards, ordinal
// sheet, and ink resolve through the selected court palette; the dim backdrop
// stays on the court-neutral legacy overlay token, and outside the gate (`kua`
// null) every value keeps the legacy palette.
const createStyles = (colors, kua = null) => StyleSheet.create({
  errorText: {
    color: kua ? kua.errorText : colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    borderColor: kua ? kua.error : colors.error,
    backgroundColor: kua ? withAlpha(kua.error, 0.14) : colors.errorSurface,
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
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
    minHeight: 44,
  },
  otherNoteInfo: {
    flex: 1,
  },
  otherNoteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: kua ? kua.onSurface : colors.text,
  },
  currentNoteTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: kua ? kua.primary : colors.accentText,
  },
  otherNoteSub: {
    fontSize: 12,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
  },
  editHint: {
    fontSize: 11,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginBottom: 8,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  generateButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  generateButtonText: {
    color: kua ? kua.primary : colors.accentText,
  },
  deloadEmpty: {
    marginTop: 40,
    alignItems: 'center',
    gap: 16,
  },
  deloadEmptyText: {
    fontSize: 16,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
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
  pastDeloadContent: {
    fontSize: 13,
    color: kua ? kua.onSurface : colors.text,
    fontFamily: 'monospace',
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  inlineActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  switchButtonText: {
    color: kua ? kua.primary : colors.accentText,
  },
  ordinalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ordinalSheet: {
    ...dialogWidthStyle,
    backgroundColor: kua ? kua.surfaceCard : colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    padding: 24,
    gap: 12,
  },
  ordinalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  ordinalSubtitle: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    lineHeight: 18,
  },
  ordinalInput: {
    backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 20,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
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
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  ordinalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: kua ? kua.primaryOnContainer : colors.textMuted,
  },
  ordinalConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  ordinalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: kua ? kua.onPrimary : colors.onAccent,
  },
});
