// Interpolate hex color a→b by t (0..1). Mirrors HomeScreen's 1K progress gradient.
export function lerpColor(a, b, t) {
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

export function formatCheckInDate(responded_at) {
  // Parse only the YYYY-MM-DD portion to avoid UTC→local-timezone day shift
  const [year, month, day] = responded_at.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
