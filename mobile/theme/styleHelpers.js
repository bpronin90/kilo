// Shared style helpers for derived colors that have no palette token.

// KUA overlay scrim (components.md → Overlays and modals): theme-neutral black
// at 0.5 opacity in light mode and 0.7 in dark, deliberately not a palette token.
export const scrim = (mode) => (mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)');

// `#rgb`/`#rrggbb` → `rgba(...)` at the given alpha, for tints derived from a
// palette role. Any other input is returned unchanged.
export function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
