// Shared info-icon explainer (#1245). Every explainer outside More uses this
// pattern: a small info icon anchored beside the label or heading it explains,
// with the explanation hidden until the icon is tapped. The icon and the note
// are separate pieces so a caller can place the icon inline with its label and
// the note wherever the layout has room for a full-width line.
import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../theme/ThemeContext';

export function useInfoExplainer(initial = false) {
  const [shown, setShown] = useState(initial);
  const toggle = useCallback(() => setShown(s => !s), []);
  return [shown, toggle];
}

// 44dp target; no auto/negative margins, so it sits beside its label by the
// row's ordinary gap and never overlaps neighbouring text.
export function InfoButton({ expanded, onPress, label, testID, style }) {
  const { colors, kuaPalette: kua } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={(e) => {
        // Some hosts sit inside a larger Pressable (Log note body).
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        onPress();
      }}
      style={[BUTTON, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: !!expanded }}
    >
      <MaterialIcons
        name="info-outline"
        size={18}
        color={kua ? kua.onSurfaceVariant : colors.textMuted}
        accessible={false}
      />
    </Pressable>
  );
}

// Always mounted so revealing the note is announced as a live region.
export function InfoNote({ shown, testID, style, children }) {
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={shown ? style : null}>
      {shown ? children : null}
    </View>
  );
}

// Theme-free, so a plain constant (no module-scope StyleSheet; see theme-rendering test).
const BUTTON = {
  minWidth: 44,
  minHeight: 44,
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
};
