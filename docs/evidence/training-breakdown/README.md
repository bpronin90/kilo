# Training breakdown (#1580): rendered evidence

- Viewport 390x844, headless Chromium (playwright-core), Analytics tab, light theme.
- State: synthetic notebook (2 notes, 30 eligible completed sets; one warm-up set, one skipped set
  and one unparsed row excluded; one note-scoped `barbell curl` -> Pull choice; unknown names
  Cable Row / Mystery Machine Thing / Pull-ups; Plank timed holds). Seeded by `capture.cjs`
  into localStorage; mock Supabase project, all other traffic blocked.
- Before: `main` at 3df760cb (`before-*.png`). After: PR head 8057003795eeeef795ea0c86214021238a90c2fe (`after-*.png`, includes cardio entry `Bike 20 min` in the seed).
- Capture: `EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key npx expo export --platform web --output-dir <dir>` then `node capture.cjs <dir> <before|after> <out>`.

Layout checklist (from before-01): 16px side gutters; section title in the existing SectionTitle
style directly after the Strength block; one white rounded card (padding 20, gap 12) like Weight
Trends; 44dp segmented options; row label left bold, count right, names beneath in muted body-sm
wrapping inside the card; no horizontal overflow; no new tab or Log control.

Comparison: PASS. after-02 (Movement), after-03-muscles and after-03-equipment show the section
after Strength and before Routine Health, rows reconcile (21 classified + 9 unclassified = 30),
coverage lines and unknown rows visible, names wrap inside the card, nothing overflows.
Names: `after-03-breakdown-equipment-collapsed-names.png` shows `+1 more` on the Unknown equipment
row; `after-03-breakdown-equipment.png` shows it expanded (all four names, Show fewer). Cardio: the
`Bike 20 min` logged entry appears under "Timed and cardio activity" as entries, not sets.

Active Recovery (`RECOVERY=1 node capture.cjs <dir> after <out>`, seeds `recovery-seed.json`: active block
with baseline note Routine 0, week 1 linked to Routine 1): `after-recovery-01-collapsed.png`
(baseline disclosure collapsed; capture logs `training-breakdown-section count = 0`) and
`after-recovery-02-expanded.png` (disclosure expanded: Training breakdown after Strength, labelled
"Paused during Recovery - baseline history", eligible baseline notes only: 6 sets). PASS.
