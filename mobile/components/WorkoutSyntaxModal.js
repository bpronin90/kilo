import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { WorkoutSyntaxReference } from './WorkoutSyntaxReference';

// Editor-reachable workout syntax reference (#584, follow-up to #573).
// Follows the PlateCalculatorModal overlay/sheet/close pattern: transparent
// fade Modal, dimmed backdrop Pressable that closes on tap, a bordered card
// sheet with a header row and ✕ close button, and onRequestClose wired to the
// same close handler (Android back). Opening/closing this overlay never
// touches the underlying editor text, so unsaved edits are preserved.
export function WorkoutSyntaxModal({ visible, onClose }) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title}>Workout syntax help</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close workout syntax help"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <WorkoutSyntaxReference />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(31,26,23,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  sheet: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    maxWidth: 420,
    maxHeight: '100%',
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingTop: 16,
    paddingBottom: 20,
  },
});
