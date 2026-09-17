import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

// KUA tab-bar icon mapping. Each entry names the MaterialIcons glyph for the
// corresponding tab. Material icons match the spec's Material Symbols Outlined
// equivalents; all glyphs are bundled with @expo/vector-icons — no runtime CDN
// or asset-loading dependency.
export const TAB_ICON_MAP = {
  Home: 'home',
  Log: 'fitness-center',
  Weight: 'monitor-weight',
  Analytics: 'bar-chart',
  More: 'more-horiz',
};

// Thin icon abstraction. Resolves a semantic tab name through TAB_ICON_MAP
// before passing to MaterialIcons, so callers reference role names rather than
// raw glyph strings. Unknown names are passed through unchanged, so non-tab
// usages still work.
export function Icon({ name, size = 24, color, style }) {
  const iconName = TAB_ICON_MAP[name] ?? name;
  return <MaterialIcons name={iconName} size={size} color={color} style={style} />;
}
