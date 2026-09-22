import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { setWebAlertHandler } from '../lib/platformAlert';

// Renders the dialogs platformAlert.js's Alert.alert queues on web, since
// react-native-web has no native Alert to back it (#721). Native
// platforms never touch this — platformAlert routes them straight to RN's
// own Alert.alert and this component renders nothing.
//
// Mounted once at the app root: Alert.alert is called imperatively from hooks
// and screens across the app, so the dialog has to live at a stable host that
// every call can reach through the shared module-level handler in
// platformAlert.js.
export function WebAlertHost() {
  const [dialog, setDialog] = useState(null);
  // Built from the resolved court palette and mode: the dialog card resolves
  // through KUA, while its scrim is the KUA-spec neutral backdrop keyed on mode
  // (#1139).
  const { colors, kuaPalette: kua, mode } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua, mode), [colors, kua, mode]);

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

// KUA overlay scrim (components.md → Overlays and modals): theme-neutral, black
// at 0.5 opacity in light mode and 0.7 in dark, deliberately not a palette token.
const scrim = (mode) => (mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)');

const createStyles = (colors, kua = null, mode = 'light') => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: kua ? scrim(mode) : colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: kua ? kua.surfaceCard : colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    padding: 20,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  message: {
    fontSize: 14,
    color: kua ? kua.onSurface : colors.text,
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
    color: kua ? kua.primary : colors.accentText,
  },
  cancelText: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '600',
  },
  destructiveText: {
    color: kua ? kua.errorText : colors.error,
  },
});
