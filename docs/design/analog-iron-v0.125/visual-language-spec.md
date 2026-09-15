# Kilo Visual Language & System Rules (v0.125 Refined Production Baseline)
**Direction:** Analog Iron & Newsprint (Identity & Tactility) + Utilitarian Restraint (Human Ergonomics)
**Product Philosophy:** Kilo looks distinctive, fast, and physical without needing to *talk* like an industrial control system. The tool-first personality lives in bold typography, sharp geometry, mechanical hairline rules, and tactile controls—not novelty copy or sci-fi jargon.

---

## 1. Voice & Copy Guidelines (No Faux-Technical Jargon)
- **Eliminated Fake Identifiers:** Strictly ban invented jargon (`TELEMETRY`, `MANIFEST`, `SYS_STATUS`, `CALCULATION PROTOCOL`, `KINEMATIC LEDGER`, `REV. 2024.11`, `SPEC 01-A`, `#BAR-01`).
- **Selective Use of Double Slash `//`:** The `//` separator is a recognizable Kilo signature, but used **sparingly** (e.g. breadcrumb subtitle `KILO · LOG` or exercise subtext `Bench Press · Paused`). Do not pepper every header, card, and row with slashes.
- **Natural, Human Copy:** Use straightforward athletic terms: `TODAY'S WORKOUT`, `CURRENT WEIGHT`, `TOTAL PROGRESSION`, `SETTINGS`, `ACCOUNT`, `BACKUP & EXPORT`, `REST TIMER`.

---

## 2. Palette & Semantic Color Usage
The core rule is **extreme restraint with red**. Red is not a decorative splash; it denotes **active execution, hard PR records, or critical state**.

| Role | Light Mode Hex | Purpose & Strict Rule |
|---|---|---|
| `background` | `#EAE6DF` | Manila newsprint foundation for the entire viewport |
| `surface` | `#F4F1EA` | Elevated card stock for active workout blocks, forms, and sheets |
| `surfaceSubtle` | `#E1DCD3` | Hairline dividers, subtle table headers, inactive day boxes |
| `ink` | `#111111` | Primary headings, values, labels, active workout text (high contrast) |
| `inkMuted` | `#66625D` | Secondary labels, dates, units, exercise notes |
| `borderHairline`| `#D5D0C5` | 1px mechanical score dividing rows and sections |
| `borderSolid` | `#111111` | Active containers, primary button strokes, heavy rules |
| `accentRed` | `#D92D20` | **Execution only:** `START WORKOUT`, active session badge, `*PR` pill, live countdown track, danger zone |
| `successGreen` | `#2E6930` | Verified sync indicators, completed days/sets check |
| `cautionAmber` | `#B45309` | Unparsed line warnings in routine editor |

---

## 3. Typography & Mobile Scale
Avoid unreadable micro-copy. Minimum legible size on mobile is `11px` (for tracked metadata only). Primary numerals and labels are crisp and punchy:

| Role | Size / Line-Height | Weight | Style | Semantic Use |
|---|---|---|---|---|
| **Display Hero** | 32px / 36px | 800 | Space Grotesk | Big metrics (`182.4 LBS`, `1,245 LBS`), Page Titles |
| **Section Title** | 16px / 20px | 700 | Space Grotesk | Section dividers, Exercise titles (UPPERCASE) |
| **Data Body** | 14px / 20px | 500 / 700 | Monospace / Sans | Sets, reps, workout lines, input fields |
| **Caption / Meta**| 12px / 16px | 500 | Grotesk / Sans | Sublabels, dates, helper copy, table text |
| **Micro Tag** | 11px / 14px | 700 | Mono (Tracked) | Table column headers (`SET`, `RPE`), Status tags (`DONE`, `PR`) |

---

## 4. Geometry & Container Restraint (Open Rules > Cards)
- **Sharp Corners:** `0px` to `2px` border radius across all buttons, inputs, and containers. No pill buttons (`rounded-full`).
- **Open Canvas Layout:** Do NOT place every section in an enclosed card. Lists, stats, and navigation live directly on the canvas, separated by generous whitespace (`20–24px`) and subtle `1px` hairlines (`#D5D0C5`).
- **Elevation:** Flat. `box-shadow: none`. Contrast and depth come from surface shade shifts (`#EAE6DF` vs `#F4F1EA`) and sharp ink rules.

---

## 5. Screen-Specific Architecture
- **Home:** Actionable launchpad with "Today's Workout" as the primary hero, a clean 7-day consistency strip directly on the canvas, and a clean overview of current metrics without heavy nested boxes.
- **Log:** Retains the plain-text editor mental model and line gutters, clean tabular sets, unambiguous `Track` / `Done` buttons, and floating Rest Timer docking cleanly above tabs.
- **Stats:** Clear hierarchy: Primary Total → The Big Three lifts → Weekly Volume bar chart → Verified Records. Ample breathing room; not an overwhelming cockpit dashboard.
- **Weight:** Single hero average, tactile stepped trend visualization, fast logging form, clean audit log.
- **Settings:** Clean human preferences (Units, Rest Timer, Theme, Backup & Data).
- **Plate Calculator Modal:** Tactical barbell sleeve schematic and plate count manifest with high-contrast actions.

---

## 6. Chart Treatment Alternatives

Three labeled alternatives for line series (Weight Trends: 7-day and 30-day rolling averages;
Strength 1K total over sessions) and bar/column series (Stats: Weekly Volume).
Each is self-contained. One must be selected by the owner before D1/D4/D8/D9 proceed.

**Scope of these alternatives.** Charts addressed: multi-series line (`AnalyticsWeightTrendsCard`
7-day + 30-day rolling average lines) and single-series line with selection (`AnalyticsStrengthSection`
1K total chart). Bar/column charts (Stats Weekly Volume) share the same role names.
Screenshot-only chart types, the specific metrics and data ranges visible in `stats-light.png`
and `weight-light.png`, and any chart not listed above remain unauthorized.

**Invariant across all alternatives.**
- Ordinary series use neutral ink. The current production warm-orange accent (`colors.accent`,
  `#d98d42`) is not carried forward as a chart series color in any alternative.
- Vermilion (`accentRed`) is reserved for comparison/PR markers and exceptional states only —
  never for an ordinary series stroke or fill.
- Multi-series charts differ by stroke style and marker shape in addition to color.
- No drop shadows, fills, gradients, or glow effects on chart elements.
- Grid lines are omitted (open canvas principle); axis rules use `borderHairline`.

---

### Alternative A — Mechanical Ink

> Reuses only existing `ink` and `inkMuted` tokens. No new tokens required.

| Element | Specification |
|---|---|
| Primary series stroke (7-day avg, 1K total) | 2px solid, color = `ink` |
| Primary point marker | Filled circle r=4, fill = `ink`, stroke = `ink` 2px |
| Secondary series stroke (30-day avg) | 1.5px dashed (4,4), color = `inkMuted` |
| Secondary point marker | Open square 6×6px, stroke-only, stroke = `inkMuted` 1.5px |
| Bar/column fill | `inkMuted` at 30% opacity |
| Bar/column top rule | 1px solid `inkMuted` |
| Axis rule | 1px `borderHairline` |
| Grid | None |
| Selected state | Same-series filled circle + 2px full-height `borderHairline` vertical band |
| Comparison/PR marker | Open diamond 8×8px stroke-only, stroke = `accentRed`, never filled |

**Non-color distinctions:** stroke weight (2px vs 1.5px), stroke style (solid vs dashed),
marker shape (filled circle vs open square).

**Tradeoffs:** Zero new tokens; maximum restraint; consistent with open-canvas spec.
Secondary series has lower visual weight, which may make it harder to track at small mobile
screen sizes. Bar opacity may read as unfinished at very high ambient brightness.

---

### Alternative B — Warm Steel

> Introduces one new semantic token pair (`chartPrimary` light + dark) that gives chart
> series a principled distinct hue — a cool iron-blue referencing the blue-gray column
> fills visible in `stats-light.png` — without reusing the accent or any status color.

| Element | Specification |
|---|---|
| Primary series stroke | 2px solid, color = `chartPrimary` |
| Primary point marker | Filled circle r=4, fill = `chartPrimary` |
| Secondary series stroke | 1.5px solid, color = `inkMuted` |
| Secondary point marker | Open upward triangle (▲) 6px base, stroke-only, `inkMuted` 1.5px |
| Bar/column fill | `chartPrimary` at 20% opacity |
| Bar/column top rule | 1px solid `chartPrimary` |
| Axis rule | 1px `borderHairline` |
| Grid | None |
| Selected state | `chartPrimary` filled circle + `chartPrimary` 10%-opacity vertical band |
| Comparison/PR marker | Open ring r=4, stroke = `accentRed`, never filled |

`chartPrimary` values: `#42535E` (light) / `#8FAAB9` (dark). See §7 for full token table.

**Non-color distinctions:** marker shape (circle vs triangle), stroke weight (2px vs 1.5px).

**Tradeoffs:** One new token pair required; must be formally approved in §7.
The steel-blue hue references the screenshot reference fills in a principled way and
provides clearer visual hierarchy at small sizes. Cannot use without token approval.

---

### Alternative C — Ink with Warm Selected

> Neutral series in existing `ink`/`inkMuted`. Selected state uses the existing
> `accentText`/`chipAccentText` warm-ink token — not vermilion — for clear affordance
> feedback without diluting execution-state semantics and without new tokens.

| Element | Specification |
|---|---|
| Primary series stroke | 2px solid, color = `ink` |
| Primary point marker | Filled circle r=4, fill = `ink` |
| Secondary series stroke | 1.5px dot-dash (1,3,4,3), color = `inkMuted` |
| Secondary point marker | Open square 6×6px, stroke-only, `inkMuted` 1.5px |
| Bar/column fill | `subtleBg` |
| Bar/column top rule | 1px solid `ink` |
| Axis rule | 1px `borderHairline` |
| Grid | None |
| Selected state | `accentText`/`chipAccentText` filled circle + `accentText`/`chipAccentText` 10%-opacity vertical band |
| Comparison/PR marker | Filled diamond 8×8px, fill = `accentRed` |

**Non-color distinctions:** stroke weight (2px vs 1.5px), stroke style (solid vs dot-dash),
marker shape (circle vs square), selected marker fill vs unselected.

**Tradeoffs:** Zero new tokens. Warm selected-state affordance is visually distinct from
the neutral series without needing a chart-specific palette. The dot-dash secondary stroke
is more visually complex than Alt A's simple dash and may appear busy on long series.

---

## 7. Chart Token Tables

### Alternative A — light/dark values

| Semantic role | Token name | Light value | Dark value |
|---|---|---|---|
| Primary series stroke | `ink` | `#111111` | `#F0F0F0` |
| Secondary series stroke | `inkMuted` | `#66625D` | `#9C9A94` |
| Selected point fill | `ink` | `#111111` | `#F0F0F0` |
| Unselected point fill | `surface` | `#F4F1EA` | `#1C1C1F` |
| Bar fill | `inkMuted` 30% | `rgba(102,98,93,0.30)` | `rgba(156,154,148,0.30)` |
| Axis rule | `borderHairline` | `#D5D0C5` | `#2C2C30` |
| Selection band | `borderHairline` | `#D5D0C5` | `#2C2C30` |
| Comparison/PR marker | `accentRed` | `#D92D20` | `#FF453A` |

### Alternative B — light/dark values

| Semantic role | Token name | Light value | Dark value |
|---|---|---|---|
| Primary series stroke | `chartPrimary` | `#42535E` | `#8FAAB9` |
| Secondary series stroke | `inkMuted` | `#66625D` | `#9C9A94` |
| Selected point fill | `chartPrimary` | `#42535E` | `#8FAAB9` |
| Unselected point fill | `surface` | `#F4F1EA` | `#1C1C1F` |
| Bar fill | `chartPrimary` 20% | `rgba(66,83,94,0.20)` | `rgba(143,170,185,0.20)` |
| Selection band | `chartPrimary` 10% | `rgba(66,83,94,0.10)` | `rgba(143,170,185,0.10)` |
| Axis rule | `borderHairline` | `#D5D0C5` | `#2C2C30` |
| Comparison/PR marker | `accentRed` | `#D92D20` | `#FF453A` |

### Alternative C — light/dark values

| Semantic role | Token name | Light value | Dark value |
|---|---|---|---|
| Primary series stroke | `ink` | `#111111` | `#F0F0F0` |
| Secondary series stroke | `inkMuted` | `#66625D` | `#9C9A94` |
| Selected point fill | `accentText` / `chipAccentText` | `#8a4e15` | `#ffc98a` |
| Unselected point fill | `surface` | `#F4F1EA` | `#1C1C1F` |
| Bar fill | `subtleBg` | `rgba(34,28,23,0.04)` | `rgba(255,255,255,0.06)` |
| Bar top rule | `ink` | `#111111` | `#F0F0F0` |
| Selection band | `accentText` / `chipAccentText` 10% | `rgba(138,78,21,0.10)` | `rgba(255,201,138,0.10)` |
| Axis rule | `borderHairline` | `#D5D0C5` | `#2C2C30` |
| Comparison/PR marker | `accentRed` | `#D92D20` | `#FF453A` |

### Old-role → approved-role mapping

These are the current production color roles used by `LineChart.js`,
`AnalyticsStrengthSection.js`, and `AnalyticsWeightTrendsCard.js`:

| Production role | Production value (light/dark) | Alt A | Alt B | Alt C |
|---|---|---|---|---|
| `colors.accent` (primary series) | `#d98d42` / `#d98d42` | `ink` | `chartPrimary` | `ink` |
| `colors.textMuted` (30-day series) | `#6b6259` / `#a29fb3` | `inkMuted` | `inkMuted` | `inkMuted` |
| `colors.card` (unselected point halo) | `#ffffff` / `#1e1c2c` | `surface` | `surface` | `surface` |
| `colors.textMuted` (routine-start line) | `#6b6259` / `#a29fb3` | `inkMuted` 50% | `inkMuted` 50% | `inkMuted` 50% |

**Neutral passive-accent treatment.** The current production warm-orange accent
(`colors.accent`, `#d98d42`) has no chart series role in any Analog Iron alternative.
Ordinary chart series use neutral ink (`ink` or `inkMuted`). The only accent-family
color appearing in chart contexts is `accentText`/`chipAccentText` in Alt C's selected
state, and that is a warm-ink token already used for text, not the orange mark color.

---

## 8. Contrast Evidence

Calculations use WCAG 2.1 relative luminance (sRGB linearization via IEC 61966-2-1).
Text and filled labels require ≥ 4.5:1 (AA normal text). Non-text marks and boundaries
require ≥ 3:1 (AA non-text). Values below are for actual render pairs, not a worst-case
palette cross-product.

### Light mode

| Pair | Role A | Role B | Ratio | Criterion | Outcome |
|---|---|---|---|---|---|
| `ink` on `surface` | `#111111` | `#F4F1EA` | 17.1:1 | AA text | ✓ |
| `ink` on `background` | `#111111` | `#EAE6DF` | 15.4:1 | AA text | ✓ |
| `inkMuted` on `surface` | `#66625D` | `#F4F1EA` | 5.3:1 | AA text | ✓ |
| `chartPrimary` on `surface` (Alt B) | `#42535E` | `#F4F1EA` | 7.2:1 | AA text | ✓ |
| `accentText` on `surface` (Alt C selected) | `#8a4e15` | `#F4F1EA` | 5.9:1 | AA text | ✓ |
| `accentRed` marker on `surface` | `#D92D20` | `#F4F1EA` | 4.3:1 | AA non-text | ✓ |
| `accentRed` marker on `background` | `#D92D20` | `#EAE6DF` | 3.9:1 | AA non-text | ✓ |

### Dark mode

| Pair | Role A | Role B | Ratio | Criterion | Outcome |
|---|---|---|---|---|---|
| `ink` on `bg` | `#F0F0F0` | `#121214` | 16.6:1 | AA text | ✓ |
| `ink` on `surface` | `#F0F0F0` | `#1C1C1F` | 15.4:1 | AA text | ✓ |
| `inkMuted` on `bg` | `#9C9A94` | `#121214` | 6.7:1 | AA text | ✓ |
| `inkMuted` on `surface` | `#9C9A94` | `#1C1C1F` | 6.3:1 | AA text | ✓ |
| `chartPrimary` on `bg` (Alt B) | `#8FAAB9` | `#121214` | 7.8:1 | AA text | ✓ |
| `chartPrimary` on `surface` (Alt B) | `#8FAAB9` | `#1C1C1F` | 7.2:1 | AA text | ✓ |
| `chipAccentText` on `surface` (Alt C selected) | `#ffc98a` | `#1C1C1F` | 10.9:1 | AA text | ✓ |
| `accentRed` marker on `bg` | `#FF453A` | `#121214` | 5.6:1 | AA non-text | ✓ |
| `accentRed` marker on `surface` | `#FF453A` | `#1C1C1F` | 5.3:1 | AA non-text | ✓ |

---

## 9. Font Evidence

### Space Grotesk available weights

Space Grotesk (Google Fonts, SIL Open Font License v1.1, source: fonts.google.com/specimen/Space+Grotesk)
ships with the following weights: 300, 400, 500, 600, 700.

**Weight 800 is not in the Space Grotesk family.** `fontWeight: '800'` on React Native
native targets is rendered at 700 (the nearest available weight — platform font matching
clamps to the heaviest loaded axis). On Expo web with a Google Fonts stylesheet, `font-weight: 800`
triggers faux-bold synthesis unless a weight-800 source is explicitly loaded.

**Decision required.** Two options:

| Option | Description |
|---|---|
| A — Approve 700 as Display Hero weight | Formally document 700 (Bold) as the effective weight for all Display Hero uses. The `fontWeight: '800'` calls in the source render at 700 on native; no source change needed. Simplest. |
| B — Source a weight-800 face | Evaluate Plus Jakarta Sans (Google Fonts, SIL OFL, weights 200–800) as a substitute for Display Hero use. Space Grotesk remains for all other roles. Requires evaluating visual consistency between the two families side by side. |

### Bundled monospace options

The spec calls for a bundled monospace face for tabular data (sets, reps, scale labels,
plate counts). Three SIL-licensed options currently available via `expo-font`:

| Font | License | Source | Notes |
|---|---|---|---|
| Space Mono | SIL OFL 1.1 | Google Fonts | Default Expo starter font; already in many Expo projects |
| JetBrains Mono | SIL OFL 1.1 | fonts.google.com / jetbrains.com | Slightly wider glyph set; includes tabular figures |
| IBM Plex Mono | SIL OFL 1.1 | Google Fonts | Narrower, higher density at 10–12px |

**Decision required.** Owner selects one. Selected font is the bundled mono face for all
tabular numeric roles in the spec's Data Body and Micro Tag rows.

### Fallback and loading behavior

Fonts are loaded asynchronously via `expo-font`. The following constraints apply
regardless of which face is selected:

1. **No blank startup.** The app must not render visible blank or invisible text while
   fonts are resolving. Acceptable approaches: hold the splash screen until fonts are
   ready (`SplashScreen.preventAutoHideAsync`), or render with system font and swap
   on load (using `fontFamily: undefined` as the loading fallback). Unacceptable: a
   fully mounted screen where text nodes exist but are invisible or missing.
2. **No draft loss.** If a user is mid-entry in the log editor when fonts finish loading,
   the swap must not unmount or reset the editor state. Font loading must not trigger a
   full component tree remount.
3. **System fallback identity.** The system fallback for Space Grotesk is `system-ui`
   (web) or the platform default sans-serif (native). For the monospace face the fallback
   is `monospace` (web) or `Courier New` (native). These fallbacks are acceptable during
   load; they must not persist after fonts are ready.

---

## 10. Native/Hosted Control Treatment

Some UI elements are partially or entirely OS-owned; the Analog Iron token contract
applies only to the app-styleable portions.

### Switches (`Switch`)

React Native's `Switch` accepts `trackColor` (inactive/active track) and `thumbColor`.
The thumb shape and animation are OS-owned on both iOS and Android; `border-radius: 0`
cannot be applied to the thumb.

**App-owned styling:**
- Inactive track: `borderHairline` (light) / `#2C2C30` (dark).
- Active track: `ink` (light) / `#F0F0F0` (dark) — neutral, not `accentRed`.
- Thumb: `surface` (light) / `#1C1C1F` (dark).

**Platform exception:** iOS renders the thumb with a system drop shadow; Android uses
a flat thumb. Neither is adjustable. Both are acceptable.

### Pickers and date inputs

Native `DateTimePicker` (via `@react-native-community/datetimepicker`) and `Picker`
present OS-owned modal or inline chrome. No Analog Iron tokens apply to the modal
chrome. The trigger control (button or inline label) is app-owned and must use
the standard typography and border treatment from the spec.

The fallback `<input type="date">` on web uses the browser's own picker chrome; the
`color-scheme` declaration (`light`/`dark`) on the root node ensures the browser
chrome matches the app's mode, but specific colors remain OS-controlled.

### Alerts (`Alert.alert`)

OS-owned dialog. Title and message text render in the OS font and color. The app
cannot apply Analog Iron tokens. Action button labels must use straightforward
athletic terminology per §1.

### Hosted CAPTCHA

If a CAPTCHA provider (e.g., Cloudflare Turnstile, reCAPTCHA) is used, it renders
in an embedded WebView with the provider's own chrome. No Analog Iron tokens apply
to the CAPTCHA frame. The surrounding container (backdrop, heading, dismiss affordance)
is app-owned and must use standard spec treatment.

### General rule

Any control whose visual chrome is OS-owned is documented here as a platform exception.
Do not attempt to override OS-owned rendering via undocumented APIs or screenshot-matching
hacks. Document the gap; implement app-owned portions to spec; accept OS-owned portions
as-is.
