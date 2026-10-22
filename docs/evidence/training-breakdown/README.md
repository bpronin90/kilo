# Training breakdown (#1580): rendered evidence

- Viewport 390x844, headless Chromium (playwright-core), Analytics tab, light theme.
- State: synthetic notebook (2 notes, 30 eligible completed sets; one warm-up set, one skipped set
  and one unparsed row excluded; one note-scoped `barbell curl` -> Pull choice; unknown names
  Cable Row / Mystery Machine Thing / Pull-ups; Plank timed holds). Seeded by `capture.cjs`
  into localStorage; mock Supabase project, all other traffic blocked.
- Before: `main` at 3df760cb (`before-*.png`). After: PR head 40b16b5d374dbe72bec927ce6bd9d7e6ee1d8f01 (`after-*.png`).
- Capture: `EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key npx expo export --platform web --output-dir <dir>` then `node capture.cjs <dir> <before|after> <out>`.

Layout checklist (from before-01): 16px side gutters; section title in the existing SectionTitle
style directly after the Strength block; one white rounded card (padding 20, gap 12) like Weight
Trends; 44dp segmented options; row label left bold, count right, names beneath in muted body-sm
wrapping inside the card; no horizontal overflow; no new tab or Log control.

Comparison: PASS. after-02 (Movement), after-03-muscles and after-03-equipment show the section
after Strength and before Routine Health, rows reconcile (21 classified + 9 unclassified = 30),
coverage lines and unknown rows visible, names wrap inside the card, nothing overflows.
Active-Recovery placement (inside the baseline disclosure, labelled paused) is covered by the
ordering and component Jest tests, not a rendered capture.
