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

  // Chart-only tokens (required if Alternative C is selected)
  subtleBg: 'rgba(255,255,255,0.06)',  // Translucent white wash; Alt C bar/column fill.
  chipAccentText: '#ffc98a',           // Warm amber-cream; Alt C selected-point and chip text (10.9:1 on surface ✓).
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

---

## 6. Chart Token Addendum (dark mode)

Dark values for the chart role contract in `visual-language-spec.md` §7.
Light values and full alternative specifications are in that section.
Only the roles that differ from existing `KILO_TOKENS_DARK` entries are listed here;
roles marked "existing" are already in §2.

### Roles common to all three alternatives (dark)

| Semantic role | Token | Dark value | Source |
|---|---|---|---|
| Primary series stroke (Alt A/C) | `ink` | `#F0F0F0` | Existing `KILO_TOKENS_DARK.ink` |
| Secondary series stroke | `inkMuted` | `#9C9A94` | Existing `KILO_TOKENS_DARK.inkMuted` |
| Unselected point fill | `surface` | `#1C1C1F` | Existing `KILO_TOKENS_DARK.surface` |
| Axis rule | `borderHairline` | `#2C2C30` | Existing `KILO_TOKENS_DARK.borderHairline` |
| Comparison/PR marker | `accentRed` | `#FF453A` | Existing `KILO_TOKENS_DARK.accentRed` |
| Selected band (Alt A) | `borderHairline` | `#2C2C30` | Existing |
| Bar fill (Alt A) | `inkMuted` 30% | `rgba(156,154,148,0.30)` | Derived from existing `inkMuted` |
| Bar fill (Alt C) | `subtleBg` | `rgba(255,255,255,0.06)` | Existing `KILO_TOKENS_DARK` subtleBg |
| Selected point fill (Alt C) | `chipAccentText` | `#ffc98a` | Existing `KILO_TOKENS_DARK.chipAccentText` |

### Alternative B new token (dark)

Alternative B requires one new token not present in `KILO_TOKENS_DARK`:

```typescript
chartPrimary: '#8FAAB9',  // Cool iron-blue. 7.8:1 on bg, 7.2:1 on surface. AA text ✓
```

If Alternative B is selected, add `chartPrimary` to `KILO_TOKENS_DARK` and define the
corresponding light value (`#42535E`) alongside the existing light palette in `colors.js`.
No other `KILO_TOKENS_DARK` entries change for any alternative.

### Invariant chart rules for dark mode

- Never use a neon or saturated hue for an ordinary chart series stroke. `accentRed`
  (`#FF453A`) is reserved for comparison/PR markers and exceptional states only.
- The warm-orange production accent (`#d98d42`) has no chart series role in dark mode.
  It is not carried forward under any alternative.
- The `inkSubtle` token (`#686660`) is decoration-only per §2 and must not be used
  for series strokes, axis rules, or any text in chart contexts.
