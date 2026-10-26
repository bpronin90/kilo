# #1655 first-use guidance — visual evidence

Issue: #1655. Viewport 390 × 844 CSS px, Chromium (Playwright), mobile/touch
emulation, light appearance, fresh isolated storage, no sign-in, non-local
requests blocked.

Rendered from: base `66f2c273e75ae3b151c239c589aea2e6d755c03b` plus the #1655
working-tree changes (pre-commit). The handoff names the commit; rerender if a
later commit touches these surfaces.

## Capture

```sh
cd mobile && APP_ENV=development EXPO_PUBLIC_APP_ENV=development CI=1 npx expo start --web --port 8098
# second shell, repo root:
PLAYWRIGHT_MODULE=<path to playwright> node docs/verification/1655-first-use-guidance/capture.cjs <out dir>
```

Steps: Skip tour → Log → (scroll empty state) → New Routine → Workout syntax
help → close → Insert example → Done → Use this routine → Analytics.

## Reference (before)

From the first-time user audit (`docs/growth/first-time-user-audit.md`, C1/C2/R1):
help never showed loads changing within one session; `-Bench` example classified
as Unclassified in Training; the saved-but-not-current card said "nothing you
log will land in it". Audit capture: `docs/growth/evidence/first-time-user-audit/breakdown.png`.

## Checklist and results

| State | Screenshot | Check | Result |
|---|---|---|---|
| Log empty state, teaching rows | [1b](1b-log-empty-state-rows.png) | `-Barbell Bench Press` and `140 5,5 135 5` rows render; descriptions wrap in their column without clipping; alignment/spacing/font sizes unchanged | Pass |
| Editor placeholder + seed | [2](2-editor-placeholder.png) | Placeholder and "Tap to try" seed show 4 lines with `-Barbell Bench Press`; no overflow | Pass |
| Syntax help sheet | [3](3-syntax-help.png) | Intro explains each new line is another session; same-session row wraps legibly; sheet scrollable, close reachable | Pass |
| Saved, not current | [4](4-saved-not-current.png) | Reads `"Untitled Routine" is saved. Make it current to keep it at the top of Log.`; title and **Use this routine** unchanged | Pass |
| Adopted | [5](5-adopted.png) | Saved 135 × 5,5,5 survives adoption (separate adoption preserved) | Pass |
| Analytics Training | [6](6-training-classified.png) | Seed's 3 sets show as Horizontal push, 100% classified (was Unclassified) | Pass |
