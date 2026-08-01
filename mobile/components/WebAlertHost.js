import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';
import { setWebAlertHandler } from '../lib/platformAlert';

// Renders the dialogs platformAlert.js's Alert.alert queues on web, since
// react-native-web has no native Alert to back it (#710 follow-up). Native
// platforms never touch this — platformAlert routes them straight to RN's
// own Alert.alert and this component renders nothing.
//
// Mounted once, near the top of LogScreen: Alert.alert is called
// imperatively from deep inside hooks with no JSX of their own, so the
// dialog has to live at a stable host the imperative call can always reach
// through the shared module-level handler in platformAlert.js.
export function WebAlertHost() {
  const [dialog, setDialog] = useState(null);
  const styles = useThemedStyles(createStyles);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    setWebAlertHandler((title, message, buttons) => {
      const normalized = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
      setDialog({ title, message, buttons: normalized });
    });
    return () => setWebAlertHandler(null);
  }, []);

  if (Platform.OS !== 'web' || !dialog) return null;

  const dismiss = (button) => {
    setDialog(null);
    button?.onPress?.();
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => dismiss(null)}>
      <View style={styles.overlay}>
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          {dialog.title ? <Text style={styles.title}>{dialog.title}</Text> : null}
          {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
          <View style={styles.actions}>
            {dialog.buttons.map((button, i) => (
              <Pressable
                key={i}
                onPress={() => dismiss(button)}
                style={styles.button}
                accessibilityRole="button"
                accessibilityLabel={button.text}
              >
                <Text
                  style={[
                    styles.buttonText,
                    button.style === 'cancel' && styles.cancelText,
                    button.style === 'destructive' && styles.destructiveText,
                  ]}
                >
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  message: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.accent,
  },
  cancelText: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  destructiveText: {
    color: colors.error,
  },
});
