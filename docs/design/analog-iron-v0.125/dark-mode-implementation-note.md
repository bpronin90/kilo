# Kilo Dark Mode Architecture & Implementation Usage Note
**System Version:** v0.125.0 (Cast Iron & Machined Surface Production Baseline)  
**Applicability:** Autonomous AI coding agents, mobile frontend engineers (React Native / Expo), and design systems.

---

## 1. Core Philosophy: Cast Iron & Machined Surface

Kilo Dark Mode is **not** an inverted color gimmick and **never pure OLED black everywhere (`#000000`)**.  
Pure black washes out mechanical depth, creates harsh ocular fatigue under gym fluorescent lighting, and flattens Kilo’s analog tactile hierarchy.

Dark mode replicates **machined cast-iron plates and industrial drafting slates**:
- Base viewport is a matte cast-iron foundation (`#121214`).
- Interactive surfaces are elevated machined plates (`#1C1C1F`).
- Controls, toggles, and table zebra bands use a tinted wash (`#252529`).
- Active inputs and deep recesses drop to carbon recess (`#0A0A0C`).

---

## 2. Final Dark Token Contract & Surface Hierarchy

```typescript
export const KILO_TOKENS_DARK = {
  // Foundation Surfaces (4-Tier Depth Ramp)
  bg: '#121214',               // Matte cast-iron viewport base.
  surface: '#1C1C1F',          // Machined iron container / card / workout editor base.
  surfaceSubtle: '#252529',    // Raised mechanical buttons, segment toggles, inactive rows.
  surfaceLowest: '#0A0A0C',    // Deep recessed data inputs (e.g. log prompt line, today's weight field).

  // Ink & Typography (Strict AA Contrast Hierarchy)
  ink: '#F0F0F0',              // Crisp chalk white (15.2:1 on #121214). Headings, active values, primary labels.
  inkMuted: '#9C9A94',         // Calibrated industrial graphite (6.1:1 on #121214, 5.5:1 on #1C1C1F). Subtitles, units, dates.
  inkSubtle: '#686660',        // Non-text decoration only; never use for text or essential indicators.

  // Hairlines & Mechanical Dividers
  borderHairline: '#2C2C30',   // 1px mechanical score dividing rows, cells, and open canvas sections.
  borderSolid: '#3E3E44',      // 1.5px structural border for cards, active containers, button strokes.
  borderHighContrast: '#F0F0F0',// Inverted high-contrast border for focused inputs / white primary buttons.

  // Semantic Accents (Strict Restraint)
  accentRed: '#FF453A',        // High-visibility Athletic Vermilion (accessible on dark surfaces).
  accentRedBg: '#3A1F1C',      // Controlled dark crimson/rust wash for Danger Zone & active workout pills.
  accentRedBorder: '#6E2A24',  // Muted crimson structural border for danger cards.
  successGreen: '#34C759',     // Stamp olive green shifted to bright gym-sync green.
  successGreenBg: '#1A2E1C',   // Subtle green wash for completed workout / sync verification.
  cautionAmber: '#F59E0B',     // Technician amber for unparsed format warning chips.
  cautionAmberBg: '#332308',   // Subtle dark amber wash for syntax warning rows.
} as const;
```

---

## 3. Calibrated Token Adjustments (Differences from Initial Spec)

During execution and legibility testing on dark surfaces, four precision adjustments were codified:

1. **`inkMuted` calibrated from `#8E8E93` to `#9C9A94`**:
   - *Rationale:* `#8E8E93` dipped to 4.4:1 contrast on `#1C1C1F` cards. Raising to `#9C9A94` guarantees strict WCAG AA (≥ 5.5:1) for secondary notes and metadata on mobile screens under glaring gym lights.
   - *Text-role rule:* Use `inkMuted`, not `inkSubtle`, for gutter line
     numbers, inactive column headers, and all other secondary text. Maintain at
     least 4.5:1 contrast against the actual background surface.
2. **`accentRed` mapped to `#FF453A` (Dark) vs `#D92D20` (Light)**:
   - *Rationale:* Dark surfaces absorb deep vermilion `#D92D20`, causing it to lose punch and read as muddy maroon. `#FF453A` maintains the identical perceptual brilliance and urgency.
3. **Danger Zone & Active Workout Surface (`#3A1F1C` + `#6E2A24`)**:
   - *Rationale:* Never use neon pink or bright red washes on dark mode. `#3A1F1C` provides an unmistakable physical rust wash that frames destructive actions and active states without visual noise.
4. **Primary Execute Action Inversion (`#F0F0F0` Fill with `#111111` Text)**:
   - *Rationale:* For secondary primary actions (e.g. `✓✓ FINISH SESSION`), a solid chalk-white block with carbon-black text provides instantaneous thumb target contrast. The primary launch CTA (`▶ START WORKOUT`, `▶ RESUME ACTIVE WORKOUT`) uses vermilion `#FF453A`.

---

## 4. Invariant Rules for Coding Agents (Both Modes)

1. **Zero Pill Controls**: `border-radius: 0px` to `2px` max across all buttons, chips, segmented switches, and cards.
2. **Zero Drop Shadows**: `box-shadow: none` everywhere. Depth is delivered by the 4 surface tiers, ordinary 1px hairline separators (`borderHairline`, `#2C2C30`), and the distinct 1.5px `borderSolid` structural frame used only for cards, active containers, and button strokes.
3. **Open Canvas Architecture**: Keep consistency strips, metric summaries, and settings groups directly on the canvas without enclosing boxes.
4. **No Low-Contrast Gray-on-Gray**: Inactive states use `#252529` with `#9C9A94` text, never dark gray text on black.
5. **Mobile Minimum Floor**: No text may render below `11px`. Space Grotesk for headers, tabular Monospace for numbers.

## 5. Reference Export Caveats

The written tokens and responsive behavior govern where the supplied dark PNGs
conflict with this note. In particular:

- `home-dark.png` and `log-dark.png` contain stale light-mode red (`#D92D20`);
  implementations must use dark `accentRed` (`#FF453A`).
- Narrow-width wrapping, clipping, and row overlap in the dark Home, Log, and
  Settings exports are capture artifacts. Content must remain legible, and rows
  and controls must grow or reflow without collision.

These caveats do not authorize visual redesign; they only prevent known export
defects from overriding the approved tokens and layout behavior.
