import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY } from '../../theme/typography';

// Account auth feedback, rendered inside the action block it belongs to (#1565).
//
// The polite live region stays mounted while its branch is shown, even with no
// message, so each new status is announced as a change to an existing region
// rather than as a freshly inserted node (which screen readers often skip).
// While empty it is taken out of flow (absolute, zero size) so it adds no extra
// gap to the parent's 12px action column; it is not hidden, so the region stays
// in the accessibility tree. It never takes focus.
export function AuthStatusMessage({ status }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  return (
    <View
      testID="account-status-region"
      accessibilityLiveRegion="polite"
      style={status ? null : styles.emptyRegion}
    >
      {status ? (
        <Text style={styles.status} accessibilityLabel="Account status">
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = (colors, kua) => StyleSheet.create({
  emptyRegion: {
    position: 'absolute',
  },
  status: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    lineHeight: 22,
    color: kua ? kua.onSurface : colors.text,
  },
});
