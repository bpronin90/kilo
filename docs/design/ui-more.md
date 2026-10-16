# More UI Contract

For maintainers changing the More menu and its sub-screen composition.

## More Screen

Source: `mobile/screens/MoreScreen.js`, `mobile/components/SettingsScreen.js`,
`mobile/components/ProfileScreen.js`, `mobile/components/AboutScreen.js`,
`mobile/components/BackupScreen.js`, `mobile/components/HelpScreen.js`, and
`mobile/screens/more/`.

More is a menu of quiet, individually actionable rows. The rows are grouped by
`SectionTitle` into **Preferences** (User Profile, Settings), **Account & Data**
(Account, Data & Backup), and **Help & Support** (App Guide, About Kilo). Rows
with supporting copy put a 13px `colors.textMuted` help line below the label;
all rows end with a 20px muted `MaterialIcons` `chevron-right` disclosure.

| Element | Property | Value |
|---|---|---|
| Menu list | gap | `12` |
| Menu row | background / border / radius | `colors.card` / 1px `colors.cardBorder` / `16` (`GEOMETRY['radius-2xl']`) |
| Menu row | padding / minimum height | `20` / `44` |
| Main label | fontSize / fontWeight / color | `17` / `600` / `colors.text` |
| Help line | fontSize / color | `13` / `colors.textMuted` |
| Disclosure | icon / size / color | `chevron-right` / `20` / `colors.textMuted` |

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

Settings' Appearance and Units controls, and Profile's height unit control, use
the shared `unitTab` segmented convention: inline 44dp targets with 12px
horizontal and 6px vertical padding, 12px/700 labels, muted inactive ink, and
the active accent treatment. Settings' fatigue multiplier is a 44dp stepper
(`borderRadius: 12`) with decrement/value/increment controls. Irreversible
Account and Backup actions stay in the error-tinted, bordered 16px-radius
**Danger Zone** containers owned by those screens, as required by
`docs/design/ui-design-rules.md` §14.
