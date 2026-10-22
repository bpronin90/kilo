import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { MODAL_SUPPORTED_ORIENTATIONS } from '../adaptiveLayout';

// Bottom scrim + sheet with stacked navigation (#1588). `stackDepth > 1` shows a
// back control that pops one level; the scrim, the close control and the system
// back gesture dismiss the whole stack.
export function BreakdownSheet({ styles, sheet, stackDepth, onBack, onClose }) {
  const visible = !!sheet;
  return (
    <Modal visible={visible} transparent animationType="slide" supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
      onRequestClose={stackDepth > 1 ? onBack : onClose}>
      <View style={styles.scrim}>
        <Pressable testID="training-breakdown-sheet-scrim" style={{ flex: 1 }} onPress={onClose}
          accessibilityRole="button" accessibilityLabel="Close details" />
        {sheet ? (
          <View testID="training-breakdown-sheet" style={styles.sheet} accessibilityViewIsModal>
            <View style={styles.grab} />
            <View style={styles.sheetHead}>
              {stackDepth > 1 ? (
                <Pressable testID="training-breakdown-sheet-back" style={styles.iconButton} onPress={onBack}
                  accessibilityRole="button" accessibilityLabel="Back">
                  <View style={styles.iconRing}><Text style={styles.iconText} accessible={false}>‹</Text></View>
                </Pressable>
              ) : <View style={{ width: 6 }} />}
              <Text testID="training-breakdown-sheet-title" style={styles.sheetTitle} accessibilityRole="header">{sheet.title}</Text>
              <Pressable testID="training-breakdown-sheet-close" style={styles.iconButton} onPress={onClose}
                accessibilityRole="button" accessibilityLabel="Close">
                <Text style={[styles.iconText, { color: styles.meta.color }]} accessible={false}>✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>{sheet.body}</ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
