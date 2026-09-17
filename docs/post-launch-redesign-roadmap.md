# Kilo Post-Launch Redesign Roadmap

**Status: Analog Iron direction retired. This roadmap covers the three-theme Kinetic Utilitarian Athletic system.**

This roadmap begins only after Kilo's production launch is externally verified. See
[`docs/play-store-readiness.md`](play-store-readiness.md) for the launch checklist.
Once that checklist is complete, this roadmap starts with shared foundation work,
then delivers all three themes and both modes without changing product behavior.

> **Redesign the product that shipped. Do not use a visual migration to change
> navigation, state handling, calculations, or data contracts.**

---

## Design specification

The implementation-ready design package lives at
[`docs/design/kinetic-utilitarian-athletic/`](design/kinetic-utilitarian-athletic/).

| File | Contents |
|---|---|
| `README.md` | Source inventory, theme summary, product constraints |
| `foundation.md` | Typography, spacing, geometry, icons, motion, accessibility |
| `tokens.md` | All six theme/mode color token tables with WCAG contrast evidence |
| `components.md` | Buttons, inputs, cards, navigation, charts, overlays, native controls |
| `surfaces.md` | Per-screen mappings and template adaptations |

The Analog Iron direction (`docs/design/analog-iron-v0.125/`) is retired and remains
as an archive only. It does not direct any implementation card on this roadmap.
PR #1101, which implemented the retired contract, does not satisfy this roadmap.

---

## Principles

- **Three themes, two modes each.** Hard Court (cobalt/navy), Clay Court (terracotta/earthen), Grass Court (court green/forest). Six fully-specified designs. No theme shares a palette with another; visual identity is preserved across the implementation.
- **Shared foundations before theme work.** Typography, tokens, and base component scaffolding land first so every subsequent card builds on a stable base.
- **No behavior changes hidden in visual cards.** Screen-migration cards are
  purely visual. Navigation, data contracts, and calculations remain unchanged.
  D5 and Phase 5 own the explicitly approved theme-selection preference and UI;
  any other behavior or persistence change stops and goes to the owner.
- **Device sign-off for visual cards.** Each screen-level visual card requires owner device sign-off before it is closed.
- **Incremental and reviewable.** Cards are sized so each produces a reviewable, mergeable PR in isolation.

---

## Phase 0 — Retire and clean up

Before theme implementation begins, close out the retired direction cleanly.

- **#Phase0-A** Archive Analog Iron: Mark `docs/design/analog-iron-v0.125/` as archived in its README. No files are deleted; they remain as historical record.
- **#Phase0-B** Remove Analog Iron labels from open issues and PRs. Re-route any open implementation work that referenced the Analog Iron spec.

---

## Phase 1 — Structural preparation (complete)

Landed before this redesign. Assigns production files over 600 lines to implementation cards and establishes the line-count ratchet. Coordinated by [#1064](https://github.com/bpronin90/kilo/issues/1064) and [#1063](https://github.com/bpronin90/kilo/issues/1063).

---

## Phase 2 — Design specification and approval (this issue)

Issue [#1095](https://github.com/bpronin90/kilo/issues/1095). The design package in `docs/design/kinetic-utilitarian-athletic/` is the deliverable. Implementation cards below may not open until the owner checklist in #1095 is fully checked.

---

## Phase 3 — Shared foundation implementation

These cards are prerequisites for all theme and screen work. They may run in parallel within this phase.

### D1 — Token system

Introduce three theme palette sets in `mobile/theme/colors.js` (or a new `mobile/theme/themes.js`). Each theme exports `LightColors` and `DarkColors` with the semantic roles defined in `tokens.md`. Existing token names are preserved so no consumer code changes outside the token file.

- **Allowed files:** `mobile/theme/colors.js`, `mobile/theme/themes.js` (new), existing theme consumers if names change
- **Acceptance:** `npm run theme-rendering` (or equivalent) passes; all six token sets are exported; no production behavior change
- **Device sign-off:** not required (token-only, no visible change until screens are wired)

### D2 — Typography and font assets

Bundle Space Grotesk and JetBrains Mono as local assets. Register weights 400/500/600/700 for Space Grotesk and 500/700 for JetBrains Mono. Define typography tokens per `foundation.md`. Remove any existing CDN or network font loading.

- **Allowed files:** `mobile/theme/typography.js` (new), `assets/fonts/`, `app.json`, existing Text component wrappers
- **Acceptance:** fonts load offline; `label-md`/`label-lg` render in JetBrains Mono; Space Grotesk renders for all body/headline roles; tabular-nums applied to metric values
- **Device sign-off:** required — verify rendering on physical device

### D3 — Spacing and geometry tokens

Add radius, spacing, and elevation tokens to the theme system per `foundation.md`. No visible change to existing screens until screen-level cards wire them in.

- **Allowed files:** `mobile/theme/spacing.js` (new or extend existing theme), existing style consumers if needed
- **Acceptance:** all token values match `foundation.md`; no production behavior change

### D4 — Icon foundation

Confirm or establish locally bundled Material-equivalent icon set. Verify tab bar and action icons render at correct sizes and colors in all six theme/mode combinations.

- **Allowed files:** `mobile/components/Icon.js` (or equivalent), `assets/icons/`, existing tab bar
- **Acceptance:** five tab bar icons render; `on-surface-variant` for inactive, `primary` for active; no CDN dependency
- **Device sign-off:** required

### D5 — Theme preview and selection plumbing

Establish theme identity as a preference independent from appearance mode before
any screen migration begins. Add a development/device preview control that lets
the owner switch among Hard Court, Clay Court, and Grass Court while retaining
the existing System / Light / Dark choice. The preview control is an
implementation and review aid, not the final Settings UX.

- Persist theme identity at `kilo.theme_selection` (or an explicitly documented
  equivalent), separate from `kilo.appearance_preference`
- Preserve the existing appearance-preference normalization and native System /
  Light / Dark synchronization
- Make all six theme/mode combinations selectable in development and owner
  device-review builds without editing source code or rebuilding between themes
- Do not expose an unfinished production-facing picker or change sync, backup,
  or other data contracts
- **Acceptance:** preference restoration, invalid-value fallback, theme/mode
  independence, and all six preview combinations have automated coverage
- **Device sign-off:** required — owner confirms that all six combinations can
  be selected before the first Phase 4 screen card starts

---

## Phase 4 — Screen migration

Each card migrates one screen. All cards in this phase require the Phase 3
foundation cards, including D5's preview mechanism, to be merged first. Each
card requires the owner to inspect that screen on a physical device in all six
theme/mode combinations before approval: Hard Court, Clay Court, and Grass
Court, each in light and dark mode. System mode must also be checked for correct
live mode resolution without treating it as a seventh visual design.

Cards should be opened as separate issues after Phase 2 (#1095) is owner-approved. The issue bodies follow the product contract in AGENTS.md.

### S1 — Log screen (Workout Notes)

The template fully covers this screen. This is the highest-priority visual migration card.

- Routine card: 2px primary border, radius-2xl, card header, section rows, exercise rows
- TRACK button: untracked and tracked states per `components.md`
- Segmented control: Recovery / Routine per `components.md`
- Page header: title, subtitle, avatar button
- Tab bar: five icons with active/inactive states

### S2 — Weight screen

Apply KUA tokens. Chart line in theme-neutral teal. PR markers use completion color.

### S3 — Analytics screen

Apply KUA tokens. Chart series use theme-neutral colors. Metric tiles use metric-display-mobile typography.

### S4 — Home screen

Apply KUA tokens. Card and section heading treatment from `surfaces.md`.

### S5 — More, Settings, Account, Backup screens

Apply KUA tokens. List rows, section headers, native controls.

---

## Phase 5 — Theme selection UI

Replace the development preview control with the polished production-facing
theme picker after all Phase 4 screens have passed six-combination owner review.

- Theme picker screen (under Settings or a new entry point TBD with owner)
- Reuse the D5 theme-selection plumbing and its separate
  `kilo.theme_selection` preference; do not overload the existing appearance
  preference
- System / Light / Dark mode toggle continues to work within each selected theme
- Remove or disable the development-only preview entry point in production
- No change to data contracts, sync, or backup

---

## Phase 6 — Final gate

A read-only completeness and consistency check before the redesign is considered done.

- All six token sets render correctly on physical device in light and dark mode for each theme
- Every Phase 4 screen has an owner sign-off record covering all six
  theme/mode combinations
- Typography renders offline with no fallback
- All chart series are legible without color alone (label/shape present)
- All documented WCAG pairs pass measured contrast on device
- TRACK completion state is never indicated by color alone
- Reduced motion: all animations are disabled or instant when reduce-motion is active
- No Analog Iron color, font reference, or component style remains in production code
- `docs/design-system-map.md` is updated to reflect the live three-theme system
- Owner gives final sign-off; roadmap status is marked complete

---

## What this roadmap does not open

- No production code changes in Phase 2 (this issue)
- No behavior changes outside the explicitly scoped theme preview, preference,
  and production selector in D5 and Phase 5
- No chart data, calculation, analytics, sync, database, or backup changes
- No unrelated product features
- No Analog Iron implementation work
