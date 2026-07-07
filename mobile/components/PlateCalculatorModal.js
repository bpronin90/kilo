import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { computePlateLoad, formatPlateWeight } from '../lib/plateMath';

// Lightweight sheet showing the per-side plate loading for a tapped weight.
// Follows the SessionCheckInModal sheet pattern (transparent fade modal,
// dimmed overlay, bordered card sheet with a header row and ✕ close).
export function PlateCalculatorModal({ visible, weight, onClose }) {
  if (!visible) return null;

  const load = computePlateLoad(weight);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title}>
              Plates for {formatPlateWeight(weight)} lb
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close plate calculator"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            {!load.valid && (
              <Text style={styles.message}>No plate math for this weight.</Text>
            )}

            {load.valid && load.belowBar && (
              <Text style={styles.message}>
                Below the {formatPlateWeight(load.barWeight)} lb bar — no plates needed.
              </Text>
            )}

            {load.valid && !load.belowBar && (
              <>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Bar</Text>
                  <Text style={styles.rowValue}>{formatPlateWeight(load.barWeight)} lb</Text>
                </View>

                {load.plates.length === 0 && load.remainder === 0 && (
                  <Text style={styles.message}>Empty bar — no plates.</Text>
                )}

                {load.plates.length > 0 && (
                  <View style={styles.plateBlock}>
                    <Text style={styles.plateBlockLabel}>Per side</Text>
                    {load.plates.map(p => (
                      <View key={p.size} style={styles.row}>
                        <Text style={styles.rowLabel}>{formatPlateWeight(p.size)} lb</Text>
                        <Text style={styles.rowValue}>× {p.count}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {load.remainder > 0 && (
                  <Text style={styles.remainder}>
                    {formatPlateWeight(load.remainder)} lb per side can't be loaded with standard plates.
                  </Text>
                )}
              </>
            )}
          </View>
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
  },
  sheet: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    maxWidth: 360,
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
    paddingTop: 16,
    paddingBottom: 20,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  plateBlock: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  plateBlockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  message: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
  },
  remainder: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 19,
  },
});
