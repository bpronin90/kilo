# Recovery movement groups (#1581): rendered evidence

- Viewport 390x844, headless Chromium (playwright-core), light theme. Mock Supabase project, all other traffic blocked.
- State: active Recovery block, baseline note "Routine 0" (6 lifts: Bench Press, RDL, Barbell Back Squat, Lat Pulldown,
  Barbell Curl, Mystery Machine Thing; frozen baseline from `seed-base.json`), week 1 linked to a lower-load note.
  Before (`main` 83a30cb9): v1 map `{barbell curl: pull}`. After (PR head 0695b851701f2102b6818b138089709a6df4af36):
  v2 map `{barbell curl: pull (legacy broad), lat pulldown: horizontal_pull (detailed)}`.
- Capture: `EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key npx expo export --platform web --output-dir <dir>`
  then `node capture.cjs <dir> before <out>` and
  `MAP=v2 OPEN=pull,horizontal_pull,other EDIT="barbell curl,lat pulldown" node capture.cjs <dir> after <out>`.

Layout checklist (from before-*): Analytics "Movement groups" disclosure keeps flat rows (bold label, compact
counts caption, % right, chevron) on the rail; exercise rows keep name/value, bar, status · source caption.
Log Manage editor: name left, "Change group" right on one line, group · source caption below; editor opens
full width under the row; radio options >= 44dp, 20px glyph, selected = filled glyph + bold; scope line above,
"Reset to automatic (...)" last; no horizontal overflow; no new screen or redesign.

Comparison: PASS.
- after-01: buckets are detailed (Horizontal push, Horizontal pull, Squat, Hip hinge) plus the legacy broad
  "Pull" bucket holding only Barbell Curl ("Your earlier broad choice") and "Other" for Mystery Machine Thing
  labelled "Automatic (name keywords)". 6 lifts in 6 groups; each lift once; per-lift % identical to before
  (Lat Pulldown 90%, Barbell Curl 87%; before's Pull 88% was their mean).
- after-02: Manage rows show detailed group + source; name and "Change group" on one line.
- after-03/04: editor lists detailed groups under broad headings; the legacy "Pull" option is shown (selected)
  only for Barbell Curl under "Broad group (your earlier choice)"; Lat Pulldown shows no broad option; reset
  reads "Reset to automatic (Elbow flexion)". before-03 shows the pre-existing editor overflowing the card's
  right edge; after-03 fits inside the card (row now wraps).
