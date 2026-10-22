# #1593 Training breakdown polish — visual evidence

Real app (Expo web export) rendered in headless Chromium. Viewport **390×844**, device pixel ratio **2**, range **90D** (default), `prefers-color-scheme` matching the appearance.

- **Before** captures: rendered commit `5c74bf0f6c7b0c0dcbca50f2e1c1f7355ac6ec4d` (origin/main at branch point).
- **After** captures: rendered commit `05c06781c52a5b7c6c23df80f1a208466a8bb5d6` (the product/test change; the later evidence-only commit cannot affect rendering).
- Approved reference: [`../1588-training-breakdown-dashboard/reference/`](../1588-training-breakdown-dashboard/reference/) — [h-equipment](../1588-training-breakdown-dashboard/reference/shots/h-equipment.png), [h-drill-allequipment](../1588-training-breakdown-dashboard/reference/shots/h-drill-allequipment.png), [h-drill-allgroups](../1588-training-breakdown-dashboard/reference/shots/h-drill-allgroups.png), [h-muscles](../1588-training-breakdown-dashboard/reference/shots/h-muscles.png).
- Original problem: [03-equipment-hard-dark](../1588-training-breakdown-dashboard/after/03-equipment-hard-dark.png), [02-muscles-hard-dark](../1588-training-breakdown-dashboard/after/02-muscles-hard-dark.png).

## Capture

```sh
# from mobile/, once per commit (before / after)
EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <dist>
# from this directory
node capture.cjs <dist> <before|after> [<playwright node_modules dir>] [<chromium path>]   # ONLY=<regex> limits shots
```

[`capture.cjs`](capture.cjs) is an adapted copy of the #1588 driver (same mock session, blocked network, same ~200-day synthetic fixture). Fixtures:

- **Default** (Equipment, All equipment, Muscles, Pecs, large text): reproduces the reported data exactly — 907 completed sets, Unknown equipment **519 / 57%**, Barbell 118 / 13%, Cable machine 78 / 9%; regions Chest 52, Back 162, Shoulders 130, Arms 96, Legs 275, Core 57.
- **Unclassified-dominant** (All movement groups): default fixture plus two unrecognised exercises ("Mystery Sled Thing", "Odd Machine Move", 6 sets every 2 days) → 1447 sets, Unclassified **627 / 43%**, largest classified group Squat 104, saved-choice group "Pull ✎" 12. The sheet is scrolled to its Unclassified row.

Every capture reported `overflowX: false` and no Training-breakdown button below 44×44.

## Checklist (written before coding, from the originals and approved reference)

- Layout unchanged: card padding, row height (label line + 6px bar), 2-column region grid, tile radius, fonts/sizes, wrapping and six-region order identical to #1588 captures.
- Equipment/All equipment: largest **known** item full width; others proportional (Cable machine 78/118 ≈ 66%), 3% minimum; Unknown muted + hatched, capped at 100%, still prints 519 / 57%, stays last, coverage line unchanged.
- All movement groups: largest classified group (incl. ✎ saved choice) full width; Unclassified hatched, capped at 100%, count/share unchanged, still last.
- Muscles: Chest tile reads "Most: Pecs"; region title stays Chest; muscle row and muscle sheet title read Pecs; back returns to Chest.
- Strips: one polarity on every tile in a theme (light strips in dark mode, dark strips in light mode as with low-intensity tiles); stronger muscles more opaque; empty-region placeholder unchanged; text ink still chosen by `heatFill`.

## Results

| State | Before | After | Result |
|---|---|---|---|
| equipment-hard-dark | [before](before/equipment-hard-dark.png) | [after](after/equipment-hard-dark.png) | PASS — before: leading known bar ~23% (scaled to Unknown 519). After: Barbell full width, Cable machine ~66%, Unknown hatched and capped, 519 / 57% unchanged; matches h-equipment proportions. |
| allequipment-hard-dark | [before](before/allequipment-hard-dark.png) | [after](after/allequipment-hard-dark.png) | PASS — all 9 known items scale to Barbell 118; Unknown capped; ordering, counts and shares unchanged; matches h-drill-allequipment. |
| muscles-hard-dark | [before](before/muscles-hard-dark.png) | [after](after/muscles-hard-dark.png) | PASS — Most: Pecs; strip polarity consistent across all six tiles (before: Legs strips flipped). Tile ink unchanged. |
| allgroups-unclassified-hard-dark | [before](before/allgroups-unclassified-hard-dark.png) | [after](after/allgroups-unclassified-hard-dark.png) | PASS — before: Squat 104 bar ~17% (scaled to Unclassified 627). After (sheet scrolled to its end, lead Squat 104 above the fold): Hip hinge 57 ≈ 55%, ✎ Pull 12 ≈ 12%, tag kept, Unclassified hatched and capped at 100% with 627 / 43%; lead full width is asserted in Jest. Matches h-drill-allgroups. |
| equipment-hard-light | [before](before/equipment-hard-light.png) | [after](after/equipment-hard-light.png) | PASS — before: leading known bar ~23% (scaled to Unknown 519). After: Barbell full width, Cable machine ~66%, Unknown hatched and capped, 519 / 57% unchanged; matches h-equipment proportions. |
| allequipment-hard-light | [before](before/allequipment-hard-light.png) | [after](after/allequipment-hard-light.png) | PASS — all 9 known items scale to Barbell 118; Unknown capped; ordering, counts and shares unchanged; matches h-drill-allequipment. |
| muscles-hard-light | [before](before/muscles-hard-light.png) | [after](after/muscles-hard-light.png) | PASS — Most: Pecs; strip polarity consistent across all six tiles (before: Legs strips flipped). Tile ink unchanged. |
| allgroups-unclassified-hard-light | [before](before/allgroups-unclassified-hard-light.png) | [after](after/allgroups-unclassified-hard-light.png) | PASS — before: Squat 104 bar ~17% (scaled to Unclassified 627). After (sheet scrolled to its end, lead Squat 104 above the fold): Hip hinge 57 ≈ 55%, ✎ Pull 12 ≈ 12%, tag kept, Unclassified hatched and capped at 100% with 627 / 43%; lead full width is asserted in Jest. Matches h-drill-allgroups. |
| equipment-clay-dark | [before](before/equipment-clay-dark.png) | [after](after/equipment-clay-dark.png) | PASS — before: leading known bar ~23% (scaled to Unknown 519). After: Barbell full width, Cable machine ~66%, Unknown hatched and capped, 519 / 57% unchanged; matches h-equipment proportions. |
| allequipment-clay-dark | [before](before/allequipment-clay-dark.png) | [after](after/allequipment-clay-dark.png) | PASS — all 9 known items scale to Barbell 118; Unknown capped; ordering, counts and shares unchanged; matches h-drill-allequipment. |
| muscles-clay-dark | [before](before/muscles-clay-dark.png) | [after](after/muscles-clay-dark.png) | PASS — Most: Pecs; strip polarity consistent across all six tiles (before: Legs strips flipped). Tile ink unchanged. |
| allgroups-unclassified-clay-dark | [before](before/allgroups-unclassified-clay-dark.png) | [after](after/allgroups-unclassified-clay-dark.png) | PASS — before: Squat 104 bar ~17% (scaled to Unclassified 627). After (sheet scrolled to its end, lead Squat 104 above the fold): Hip hinge 57 ≈ 55%, ✎ Pull 12 ≈ 12%, tag kept, Unclassified hatched and capped at 100% with 627 / 43%; lead full width is asserted in Jest. Matches h-drill-allgroups. |
| equipment-clay-light | [before](before/equipment-clay-light.png) | [after](after/equipment-clay-light.png) | PASS — before: leading known bar ~23% (scaled to Unknown 519). After: Barbell full width, Cable machine ~66%, Unknown hatched and capped, 519 / 57% unchanged; matches h-equipment proportions. |
| allequipment-clay-light | [before](before/allequipment-clay-light.png) | [after](after/allequipment-clay-light.png) | PASS — all 9 known items scale to Barbell 118; Unknown capped; ordering, counts and shares unchanged; matches h-drill-allequipment. |
| muscles-clay-light | [before](before/muscles-clay-light.png) | [after](after/muscles-clay-light.png) | PASS — Most: Pecs; strip polarity consistent across all six tiles (before: Legs strips flipped). Tile ink unchanged. |
| allgroups-unclassified-clay-light | [before](before/allgroups-unclassified-clay-light.png) | [after](after/allgroups-unclassified-clay-light.png) | PASS — before: Squat 104 bar ~17% (scaled to Unclassified 627). After (sheet scrolled to its end, lead Squat 104 above the fold): Hip hinge 57 ≈ 55%, ✎ Pull 12 ≈ 12%, tag kept, Unclassified hatched and capped at 100% with 627 / 43%; lead full width is asserted in Jest. Matches h-drill-allgroups. |
| equipment-grass-dark | [before](before/equipment-grass-dark.png) | [after](after/equipment-grass-dark.png) | PASS — before: leading known bar ~23% (scaled to Unknown 519). After: Barbell full width, Cable machine ~66%, Unknown hatched and capped, 519 / 57% unchanged; matches h-equipment proportions. |
| allequipment-grass-dark | [before](before/allequipment-grass-dark.png) | [after](after/allequipment-grass-dark.png) | PASS — all 9 known items scale to Barbell 118; Unknown capped; ordering, counts and shares unchanged; matches h-drill-allequipment. |
| muscles-grass-dark | [before](before/muscles-grass-dark.png) | [after](after/muscles-grass-dark.png) | PASS — Most: Pecs; strip polarity consistent across all six tiles (before: Legs strips flipped). Tile ink unchanged. |
| allgroups-unclassified-grass-dark | [before](before/allgroups-unclassified-grass-dark.png) | [after](after/allgroups-unclassified-grass-dark.png) | PASS — before: Squat 104 bar ~17% (scaled to Unclassified 627). After (sheet scrolled to its end, lead Squat 104 above the fold): Hip hinge 57 ≈ 55%, ✎ Pull 12 ≈ 12%, tag kept, Unclassified hatched and capped at 100% with 627 / 43%; lead full width is asserted in Jest. Matches h-drill-allgroups. |
| equipment-grass-light | [before](before/equipment-grass-light.png) | [after](after/equipment-grass-light.png) | PASS — before: leading known bar ~23% (scaled to Unknown 519). After: Barbell full width, Cable machine ~66%, Unknown hatched and capped, 519 / 57% unchanged; matches h-equipment proportions. |
| allequipment-grass-light | [before](before/allequipment-grass-light.png) | [after](after/allequipment-grass-light.png) | PASS — all 9 known items scale to Barbell 118; Unknown capped; ordering, counts and shares unchanged; matches h-drill-allequipment. |
| muscles-grass-light | [before](before/muscles-grass-light.png) | [after](after/muscles-grass-light.png) | PASS — Most: Pecs; strip polarity consistent across all six tiles (before: Legs strips flipped). Tile ink unchanged. |
| allgroups-unclassified-grass-light | [before](before/allgroups-unclassified-grass-light.png) | [after](after/allgroups-unclassified-grass-light.png) | PASS — before: Squat 104 bar ~17% (scaled to Unclassified 627). After (sheet scrolled to its end, lead Squat 104 above the fold): Hip hinge 57 ≈ 55%, ✎ Pull 12 ≈ 12%, tag kept, Unclassified hatched and capped at 100% with 627 / 43%; lead full width is asserted in Jest. Matches h-drill-allgroups. |
| pecs-region-hard-dark | [before](before/pecs-region-hard-dark.png) | [after](after/pecs-region-hard-dark.png) | PASS — region sheet title Chest, row reads Pecs. |
| pecs-detail-hard-dark | [before](before/pecs-detail-hard-dark.png) | [after](after/pecs-detail-hard-dark.png) | PASS — muscle sheet title Pecs (before: Chest), back button present. |
| pecs-back-hard-dark | [before](before/pecs-back-hard-dark.png) | [after](after/pecs-back-hard-dark.png) | PASS — back returns to the Chest region sheet. |
| large-text-muscles-hard-dark | [before](before/large-text-muscles-hard-dark.png) | [after](after/large-text-muscles-hard-dark.png) | PASS — at 1.3× text "Most: Pecs" and region labels fit without clipping; no horizontal overflow. |
| large-text-equipment-hard-dark | [before](before/large-text-equipment-hard-dark.png) | [after](after/large-text-equipment-hard-dark.png) | PASS — labels/counts fit; bars scaled to Barbell; Unknown capped. |

Permitted differences vs the reference: theme-token colours (Kilo court palettes instead of the prototype hex), and sample data (the app fixture, not the prototype's). In light themes strips are dark (the surface ink), whereas the dark-only reference uses white; this is the same rule (one polarity per theme, from the palette's surface ink) applied to a light surface, where white strips would vanish on low-intensity tiles.

## Notes

- **Short-name audit:** every `MUSCLE_SHORT_NAMES` entry was compared against its owning `MUSCLE_REGIONS` label; `pectoralis_major` → "Chest" was the only collision. Now "Pecs"; a test asserts there are no collisions.
- **Legacy palette:** unreachable. `ThemeContext` always supplies `KUA_PALETTES[themeKey(selection)][mode]` (unknown slugs fall back to Hard court), so `resolveBreakdownPalette`'s legacy branch is not rendered in the app; strips use `p.ink`, which that branch also defines.
- Movement tiles and the Compared bars were not changed (same before/after in code; `MovementView` untouched).
