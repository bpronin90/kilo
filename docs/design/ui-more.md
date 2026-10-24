# More UI Contract

For maintainers changing the More menu and its sub-screen composition.

## More Screen

Source: `mobile/screens/MoreScreen.js`, `mobile/components/SettingsScreen.js`,
`mobile/components/ProfileScreen.js`, `mobile/components/AboutScreen.js`,
`mobile/components/BackupScreen.js`, `mobile/components/HelpScreen.js`, and
`mobile/screens/more/`.

More (Redesign v3, #1608; source `mobile/screens/more/MoreMenuPanels.js`)
opens with an **account summary row**: a 48px accent avatar (email initial, or
a person glyph), the auth email (or "Not signed in" / "Checking sign-in…" /
"Cloud account" when cloud is unavailable), and one status line. The status
reads only the existing `auth` prop and the shell-published
`useCloudSyncSummary()` value (`Signed in · <statusLabel>`, tinted done /
warning / error by the summary's own flags); with no summary it says only
"Signed in" and never infers success. The row opens Account.

Below it, three flat grouped panels under mono uppercase labels:
**Preferences** (Settings, User profile), **Account & data** (Account, Data and
backup, Import routine) and **Tools & help** (Routine prompt tools, App guide,
About Kilo with the current version). Each row is a 22px accent icon, a 16px
title, a one-line 13px muted subtitle and a muted `chevron-right`. Rows in a
panel share 1px `cardBorder` hairlines; the panel corners are
`GEOMETRY['radius-2xl']`. Every row is a `button` with a 44dp floor and keeps
its pre-redesign accessible name (`User Profile`, `Data and Backup`,
`Import Routine`, `App Guide`, ...); the App Guide row also keeps its
production visible title.

The top-level destinations Settings, Profile, About, Backup, Help, and Account
are `ScreenShell` views that receive `onBack={() => showView('menu')}` from
`MoreScreen`. The remaining listed surfaces are nested ownership details, not
More-menu destinations: `AccountScreen` renders `AccountLifecycle` and
`LegalLinks` inline; `BackupScreen` renders `CloudSyncRecovery` inline; and
`CloudSyncRecovery` owns the inline `HealthDataConsent` step. A recovery session
in `AccountScreen` renders the separate `SetNewPasswordScreen`, which has its
own `ScreenShell` and receives Account's `onBack` callback. These nested
components remain part of their parent flows rather than adding rows to the
top-level menu.

Settings keeps production's order, labels and controls: Features, Reminders,
Appearance, Units, Advanced. Each section is one flat `Panel` under an
uppercase label (`mobile/components/settings/SettingsPanels.js`); rows are
padded blocks split by hairlines, never nested cards, and save-failure banners
sit inside the row they describe. `ReminderSettingsCard` and
`ThemeSelectionControl` take a `flat` prop for this; other callers keep their
default card presentation. Appearance Mode and Weight unit share one compact
segmented control (44dp targets holding 12/6-padded, 8px-radius pills); Mode
stacks under its label. The fatigue multiplier is a 44dp stepper
(`borderRadius: 12`) with "Reset to default (1.07)" under it. Irreversible
Account and Backup actions stay in the error-tinted, bordered 16px-radius
**Danger Zone** containers owned by those screens, as required by
`docs/design/ui-design-rules.md` §14.

Account auth feedback (`AuthStatusMessage`, #1565) renders inside the action
block it belongs to, as one more item in that block's 12px column: signed out,
after the sign-in/create/reset/OAuth buttons and before the legal links; signed
in, directly after Sign Out and before the Danger Zone; on the confirmation
panel, after the resend and back actions. The text is `body-md` with a 22px
line height in `onSurface` (`colors.text` in legacy mode) and wraps within the
column. Each branch keeps one polite live region (`accessibilityLiveRegion`,
`aria-live="polite"` on web) mounted while it is shown; it sits out of flow
while empty, so it adds no gap, and it never takes focus. Feedback from an
action that switches branches, such as "Signed in." or "Signed out.", appears
in the new branch's region.
