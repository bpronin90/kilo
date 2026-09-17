# Kinetic Utilitarian Athletic — Design Package

**Status:** Complete. Pending owner approval of all checklist items in issue #1095.

This directory is the implementation-ready design specification for Kilo's three-theme system. It replaces the retired Analog Iron direction (`docs/design/analog-iron-v0.125/`).

## Contents

| File | What it covers |
|---|---|
| `foundation.md` | Shared KUA system: typography, spacing, geometry, elevation, icons, motion, accessibility |
| `tokens.md` | Color token tables for all six theme/mode designs with WCAG 2.1 contrast evidence |
| `components.md` | Buttons, inputs, cards, navigation, charts, overlays, native controls, state treatments |
| `surfaces.md` | Kilo surface mappings and documented template adaptations for all eight product surfaces |

## Source material inventory

The files under `new design templates/` map as follows:

| Directory | Maps to |
|---|---|
| `kilo_hard_court_us_open_light/` | Hard Court light — **authoritative** |
| `kilo_hard_court_us_open_dark/` | Hard Court dark — **authoritative** |
| `kilo_clay_court_roland_garros_light/` | Clay Court light — **authoritative** |
| `kilo_clay_court_roland_garros_dark/` | Clay Court dark — **authoritative** |
| `kilo_grass_court_wimbledon_light/` | Grass Court light — **authoritative** |
| `kilo_grass_court_wimbledon_dark/` | Grass Court dark — **authoritative** |
| `kilo_tennis_suite_hard_court_us_open/` | Hard Court supporting iteration — not a separate theme |
| `kilo_tennis_suite_clay_court_roland_garros/` | Clay Court supporting iteration — not a separate theme |
| `kilo_tennis_suite_grass_court_wimbledon/` | Grass Court supporting iteration — not a separate theme |
| `kinetic_utilitarian_athletic/DESIGN.md` | Shared foundation — used for typography, density, geometry, and design principles only; its generic blue/green palette does **not** apply to any theme |

The six authoritative `screen.png` files are the visual reference for the Log (Workout Notes) screen. The `code.html` files are evidence for token values, layout, hierarchy, and component treatment. Neither file is production code; Tailwind classes, CDN dependencies, Google Fonts loading, Material Symbols, simulated system chrome, tournament branding, and template-only interactions are not carried into Kilo.

## Theme families

Three themes, two modes each, six designs total.

| Theme | Palette identity | Light mode anchor | Dark mode anchor |
|---|---|---|---|
| Hard Court | Cobalt blue / cool navy | `#0A4ABF` primary, `#EEF3F9` canvas | `#3B82F6` primary, `#080D18` canvas |
| Clay Court | Terracotta / earthen | `#C85A32` primary, `#F8F5EE` canvas | `#D86538` primary, `#141211` canvas |
| Grass Court | Court green / forest | `#1E5B3A` primary, `#F4F8F5` canvas | `#2CA864` primary, `#0C130F` canvas |

## What this package does not change

- Five-tab information architecture and tab-bar behavior
- Product behavior, navigation, state handling, calculations, data contracts
- React Native implementation constraints
- Dynamic type and safe-area behavior
- Reduced-motion support
- 44×44dp touch targets (Track-toggle exception remains owner-approved)
- No-overflow-menu rule
- Native and hosted control boundaries
- Offline startup — no runtime font or asset dependency
