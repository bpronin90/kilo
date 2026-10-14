import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';

// The official Kilo wordmark, shared by the Home title and the app startup
// overlay (#1372). Source artwork: src/assets/brand/home-title.svg
// The letterforms follow the palette `text` so the mark reads in both modes,
// but the two #FF5C00 accents are the fixed Kilo brand orange and are
// intentionally NOT themed — they are the only hardcoded colors left in the
// migrated production surfaces (#689).
export function KiloWordmark({ width = 140, height = 48 }) {
  const { colors, kuaPalette: kua } = useTheme();
  const letterColor = kua ? kua.onSurface : colors.text;
  return (
    <View style={{ width, height, justifyContent: 'center', marginLeft: -8 }}>
      <Svg width="100%" height="100%" viewBox="0 0 303 106">
        {/* K */}
        <Rect x="8" y="9" width="7" height="88" rx="3.5" ry="3.5" fill={letterColor} />
        <Path d="M 21 52 L 43 52 L 78 12 M 43 52 L 78 92" fill="none" stroke={letterColor} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* I */}
        <Rect x="102" y="30" width="7" height="66" rx="3.5" ry="3.5" fill={letterColor} />
        <Rect x="102" y="10" width="7" height="15" rx="3.5" ry="3.5" fill="#FF5C00" />
        {/* L */}
        <Path d="M 136.5 12.5 V 80.5 A 12 12 0 0 0 148.5 92.5 H 178.5" fill="none" stroke={letterColor} strokeWidth="7" strokeLinecap="round" />
        {/* O (dot) */}
        <Rect x="187" y="89.5" width="16" height="7" rx="3.5" ry="3.5" fill="#FF5C00" />
        {/* O (circle) */}
        <Path d="M 251.5 11.5 C 282.7 11.5 290.5 19.7 290.5 52.5 C 290.5 85.3 282.7 93.5 251.5 93.5 C 220.3 93.5 212.5 85.3 212.5 52.5 C 212.5 19.7 220.3 11.5 251.5 11.5 Z" fill="none" stroke={letterColor} strokeWidth="7" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}
