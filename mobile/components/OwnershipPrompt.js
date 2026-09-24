import React, { useContext, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useKuaStyle, useTheme } from '../theme/ThemeContext';
import { Button } from './UI';
import { DIALOG_MAX_WIDTH } from './adaptiveLayout';

// KUA overlay scrim (components.md → Overlays and modals): a theme-neutral
// backdrop, black at 0.5 opacity in light mode and 0.7 in dark, deliberately
// not a palette token. Mirrors the scrim helper the recovery/check-in modals
// use (and its theme-rendering.test.js hardcoded-color allowance).
const scrim = (mode) => (mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)');

// First-sign-in local-history ownership decision, rendered over the whole shell
// by App.js. The card scrolls inside the overlay and caps its width so every
// choice stays reachable in short landscape windows and does not stretch
// across a tablet (#1126).
export function OwnershipPrompt({ type, canRestore, onUpload, onDownload, onStartFresh, onDismiss }) {
  const { colors, mode } = useTheme();
  const kua = useKuaStyle();
  const insets = useContext(SafeAreaInsetsContext) || {};
  const styles = useMemo(() => createStyles(colors, kua, mode), [colors, kua, mode]);
  const edgePadding = {
    paddingTop: 24 + (insets.top || 0),
    paddingBottom: 24 + (insets.bottom || 0),
  };

  return (
    <View style={styles.ownershipOverlay} testID="ownership-prompt">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, edgePadding]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.ownershipCard}>
          {type === 'first-upload' ? (
            <>
              <Text style={styles.ownershipTitle}>
                Upload your local history?
              </Text>
              <Text style={styles.ownershipBody}>
                This is your first sign-in on this device. Kilo can upload
                the training history saved here into your account
                {canRestore
                  ? ', or download the data already in your account onto this device.'
                  : ' so it stays in sync across your devices.'}
              </Text>
              <Button
                title="Upload My History"
                loadingTitle="Working…"
                onPress={() => onUpload()}
              />
              {canRestore ? (
                <>
                  <Button
                    title="Download My Account's Data"
                    loadingTitle="Working…"
                    onPress={() => onDownload()}
                  />
                  <Text style={styles.ownershipHint}>
                    This device is empty. Pull the data already in your
                    account down onto it — nothing is uploaded.
                  </Text>
                </>
              ) : null}
              <Button title="Not Now" onPress={onDismiss} />
            </>
          ) : (
            <>
              <Text style={styles.ownershipTitle}>
                This device holds another account's history
              </Text>
              <Text style={styles.ownershipBody}>
                The training history saved on this device belongs to a
                different account. Choose what to do before cloud sync
                starts. Nothing is uploaded until you decide.
              </Text>
              <Button
                title="Start Fresh on This Device"
                loadingTitle="Working…"
                onPress={() => onStartFresh()}
              />
              <Text style={styles.ownershipHint}>
                Recommended. Removes the history stored on this device,
                then downloads your account's own data. The other
                account's cloud copy is not affected.
              </Text>
              <Button
                title="Upload It Into My Account"
                loadingTitle="Working…"
                onPress={() => onUpload()}
              />
              <Text style={styles.ownershipHint}>
                Only choose this if the history on this device is really
                yours.
              </Text>
              <Button title="Decide Later" onPress={onDismiss} />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors, kua = null, mode = 'light') => StyleSheet.create({
  ownershipOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: kua ? scrim(mode) : colors.overlay,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ownershipCard: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: DIALOG_MAX_WIDTH,
    backgroundColor: kua ? kua.surfaceCard : colors.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    padding: 20,
    gap: 12,
  },
  ownershipTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  ownershipBody: {
    fontSize: 15,
    color: kua ? kua.onSurface : colors.text,
    lineHeight: 22,
  },
  ownershipHint: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    lineHeight: 18,
    marginTop: -6,
  },
});
