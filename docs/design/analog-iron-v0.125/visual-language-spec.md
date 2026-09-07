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
