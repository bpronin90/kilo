# R9 (#1608) visual evidence — More and Settings grouped panels

- **Rendered commits:** More menu states (`more-*`, `back-to-menu-*`) at `547babc22a3a9a41061453be4668b3b2bcf8ec90` (App Guide row title restored to production casing); Settings, destination, recovery and Cloud Sync anchor states at `a8344a26e558606169db8e36b6d22a9e32ad9ff1` — 547babc changes only that menu-row title, which those states do not show. Real app Expo web export, not prototype HTML. Other commits add only docs, evidence and the changelog fragment.
- **Viewport:** 390×844 @2x via the shared harness (`../capture.cjs`, read-only); issue-local overlays in `fixtures.cjs`.
- **Themes:** every state in hard-dark and clay-light; More and Settings first screens also in grass-light and clay-dark (`*-first-*`, full page).
- **References:** `docs/design/app-redesign-v3/shots/hybrid/` more-hard-dark, more-clay-light, full-more-hard-dark, state-more-settings-hard-dark.

## Layout checklist (from the references)

1. Account row: one panel, 48px accent avatar with the email initial, 16px email, status line with sync icon tinted by state; chevron; opens Account.
2. Group labels: mono uppercase, muted, 4px inset; Preferences, Account & data, Tools & help.
3. Rows: 22px accent icon, 16px title, one-line 13px muted subtitle (ellipsised), muted chevron; ~60px rows, 44dp floor; 1px hairlines between rows, one flat panel per group, 2xl corners.
4. Settings: production order Features → Reminders → Appearance → Units → Advanced; one flat panel per section, hairline-split rows, no nested cards; title left / control right; Mode stacked.
5. Row titles follow the reference's sentence case except **App Guide**, which keeps production's visible text because existing Log-tab tests (outside this issue) open it by that text.
6. Unchanged: every destination and its content, sub-screen shell/back bar (shared R1 shell), copy of every setting, error banners, reset button.

## Reproduction

```sh
cd mobile && EXPO_PUBLIC_SUPABASE_URL=https://mockproj.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=local-anon-key \
  npx expo export --platform web --output-dir <scratch>/dist
cd .. && KILO_RENDERED_COMMIT=<commit> \
  node docs/evidence/app-redesign-v3/r9/capture.cjs <scratch>/dist /tmp/kilo-review-tools/node_modules <scratch>/r9work
```

All 60 states captured without a step failure (full run at a8344a2; `more,back` rerun at 547babc with the same command plus that `only` filter). `theme_check` reads false only on `settings-court-*` / `settings-mode-*` shots whose court or mode differs from the seeded one, because those states change the theme on purpose.

Raw Playwright on `session.page` (the shared API has no hook for these): signed-out drops the seeded `sb-mockproj-auth-token` and reloads; recovery seeds `kilo.auth.recoveryPending` (overlay) and boots on `/#error=access_denied&error_description=…`; failed save makes `localStorage.setItem('kilo_fatigue_tracking_enabled', …)` throw.

## Degradation, failures and preserved capabilities

- Account row honesty: signed in with no sync pass shows "Signed in · Ready to sync" (`more-signed-in`); a queued local change shows the warning tone "1 pending local change" (`more-sync-pending`); signed out shows "Not signed in" with no sync claim, Account row kept (`more-signed-out`).
- **Limitation, sync error:** the mock backend could not be made to record a failed sync pass from the web export (Sync Now with REST answering 500 left the summary at pending), so no error render is included. The error tone (`hasFailed` → "Signed in · <statusLabel>" in the error colour, `sync-problem` icon, failure winning over an older success) is covered by `mobile/tests/redesign-more-settings.test.js`. No sync code was changed.
- **Limitation, reminder times:** reminders are native-only; on web, switching one on shows the production inline failure ("Reminders need the mobile app…") instead of the time rows (`settings-reminder-times`). The time rows keep their unchanged markup inside the flat block; `reminder-settings-card.test.js` (28 tests) covers them.
- Failed Fatigue tracking save: switch keeps the stored value, banner with Retry inside the row (`settings-toggle-failed`).
- All eight destinations open with unchanged content (`dest-*`); back from each returns to the grouped menu (`back-to-menu`, asserted per destination).
- Expired password-recovery link routes to Account → Set New Password with the readable error (`recovery-error`).
- Home sync chip opens Data and backup at the Cloud Sync panel (typed subview + anchor) (`cloud-sync-anchor`).
- Every court and Light/Dark/System (`settings-court-*`, `settings-mode-*`), lb → kg (`settings-units-kg`), multiplier stepped and reset to 1.07 (`settings-multiplier*`).
- The `← Home` button above the More title is App.js's existing web-only cross-tab back control, outside this issue.

## States

| After | Reference | Result |
|---|---|---|
| [back-to-menu-clay-light](after/back-to-menu-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [back-to-menu-hard-dark](after/back-to-menu-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [cloud-sync-anchor-clay-light](after/cloud-sync-anchor-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [cloud-sync-anchor-hard-dark](after/cloud-sync-anchor-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-about-clay-light](after/dest-about-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-about-hard-dark](after/dest-about-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-account-clay-light](after/dest-account-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-account-hard-dark](after/dest-account-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-backup-clay-light](after/dest-backup-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-backup-hard-dark](after/dest-backup-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-guide-clay-light](after/dest-guide-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-guide-hard-dark](after/dest-guide-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-import-clay-light](after/dest-import-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-import-hard-dark](after/dest-import-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-profile-clay-light](after/dest-profile-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-profile-hard-dark](after/dest-profile-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-prompts-clay-light](after/dest-prompts-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-prompts-hard-dark](after/dest-prompts-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-settings-clay-light](after/dest-settings-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [dest-settings-hard-dark](after/dest-settings-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-first-clay-dark](after/more-first-clay-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-first-clay-light](after/more-first-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-first-grass-light](after/more-first-grass-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-first-hard-dark](after/more-first-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-signed-in-clay-light](after/more-signed-in-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-signed-in-hard-dark](after/more-signed-in-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-signed-out-clay-light](after/more-signed-out-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-signed-out-hard-dark](after/more-signed-out-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-sync-pending-clay-light](after/more-sync-pending-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [more-sync-pending-hard-dark](after/more-sync-pending-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [recovery-error-clay-light](after/recovery-error-clay-light.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [recovery-error-hard-dark](after/recovery-error-hard-dark.png) | [full-more-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/full-more-hard-dark.png) | Pass |
| [settings-court-clay-clay-light](after/settings-court-clay-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-court-clay-hard-dark](after/settings-court-clay-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-court-grass-clay-light](after/settings-court-grass-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-court-grass-hard-dark](after/settings-court-grass-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-court-hard-clay-light](after/settings-court-hard-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-court-hard-hard-dark](after/settings-court-hard-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-first-clay-dark](after/settings-first-clay-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-first-clay-light](after/settings-first-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-first-grass-light](after/settings-first-grass-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-first-hard-dark](after/settings-first-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-mode-dark-clay-light](after/settings-mode-dark-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-mode-dark-hard-dark](after/settings-mode-dark-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-mode-light-clay-light](after/settings-mode-light-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-mode-light-hard-dark](after/settings-mode-light-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-mode-system-clay-light](after/settings-mode-system-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-mode-system-hard-dark](after/settings-mode-system-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-multiplier-clay-light](after/settings-multiplier-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-multiplier-hard-dark](after/settings-multiplier-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-multiplier-reset-clay-light](after/settings-multiplier-reset-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-multiplier-reset-hard-dark](after/settings-multiplier-reset-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-reminder-times-clay-light](after/settings-reminder-times-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-reminder-times-hard-dark](after/settings-reminder-times-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-toggle-failed-clay-light](after/settings-toggle-failed-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-toggle-failed-hard-dark](after/settings-toggle-failed-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-toggles-on-clay-light](after/settings-toggles-on-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-toggles-on-hard-dark](after/settings-toggles-on-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-units-kg-clay-light](after/settings-units-kg-clay-light.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
| [settings-units-kg-hard-dark](after/settings-units-kg-hard-dark.png) | [state-more-settings-hard-dark.png](../../../design/app-redesign-v3/shots/hybrid/state-more-settings-hard-dark.png) | Pass |
