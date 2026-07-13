# Play Store Readiness Checklist

Status key: **done** | **user-action-pending** | **blocked**

Package: `com.benpronin.kilo`  
Account type: Personal developer account (subject to closed-testing requirement before production access)

---

## Closed Testing Requirement

Google requires personal developer accounts to complete a closed test before applying for production access.

| Item | Status |
|---|---|
| Create a closed testing track in Play Console | user-action-pending |
| Add ≥12 testers and share opt-in link | user-action-pending |
| Testers opt in and remain active for 14 continuous days | user-action-pending |
| Apply for production access after 14-day window | user-action-pending |

---

## Play Console App Content Declarations

### Privacy Policy
| Item | Status | Notes |
|---|---|---|
| Privacy policy URL hosted | done | `https://bpronin90.github.io/privacy.html` |
| URL entered in Play Console | user-action-pending | |
| Policy unfilled template blanks | done | Resolved by #469: policy rewritten to match observed data flows |

### Data Safety Form
The form must agree with the published privacy policy, which #469 aligned to the observed data flows. All collection below is optional: Kilo is fully usable without an account, and cloud sync is opt-in.

| Item | Status | Notes |
|---|---|---|
| Data safety form submitted | user-action-pending | |
| Email address declared | user-action-pending | Personal info → Email address; account only |
| User ID declared | user-action-pending | Personal info → User IDs (Kilo account user ID) |
| Name declared | user-action-pending | Personal info → Name (`display_name`) |
| Health info declared | user-action-pending | Health & Fitness → Health info: weight entries, weight goal, archived goals |
| Fitness info declared | user-action-pending | Health & Fitness → Fitness info: workout notes, deload and fatigue history |
| Synced preferences/toggles declared | user-action-pending | `user_profile` and `feature_toggles` rows: units, tracked lifts, workout-display state, fatigue/deload settings |
| Crash logs / diagnostics declared | user-action-pending | App info and performance; applies only if the release build ships `EXPO_PUBLIC_SENTRY_DSN`. Sentry runs with `sendDefaultPii: false` |
| Password credential treatment confirmed | user-action-pending | Email/password sign-in submits the credential to Supabase Auth; Kilo stores no plaintext password. Confirm the current Play data-type list before declaring or omitting a category |
| IP rate-limit records treatment confirmed | user-action-pending | IP and user-ID rows persist in `kilo.rate_limit_hits` (10 min export, 1 h delete; cleanup every 30 min), so the ephemeral-processing exemption may not apply |
| No device/install ID collected | done | The per-install sync `client_id` never leaves the device; the `transport.js` upsert whitelist strips it and no `kilo` table stores it |
| Collection is optional (no account required) | done | Local-only use requires no signup |
| Data deletion option declared | done | In-app deletion via account-delete Edge Function (#322); web deletion-request path on privacy page |
| "Encrypted in transit" checked | user-action-pending | True for all Supabase-backed data (HTTPS/TLS) |

### Health Apps Declaration
| Item | Status |
|---|---|
| Complete Health apps declaration in Play Console | user-action-pending |

### Account Deletion
| Item | Status | Notes |
|---|---|---|
| In-app account deletion | done | Settings → account lifecycle → delete account (Edge Function #322) |
| Web deletion request path | done | `https://bpronin90.github.io/privacy.html` deletion-request section |
| Deletion URLs entered in Play Console | user-action-pending | |

### Content Rating Questionnaire
| Item | Status |
|---|---|
| Complete IARC questionnaire in Play Console | user-action-pending |

### Target Audience & Content
| Item | Status | Notes |
|---|---|---|
| Target audience declared | user-action-pending | Adults (18+) |
| Content type declared | user-action-pending | Health & Fitness |

### Ads Declaration
| Item | Status | Notes |
|---|---|---|
| Ads declaration | user-action-pending | No ads — declare "Does not contain ads" |

---

## Store Listing Assets

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512×512 px PNG | user-action-pending |
| Feature graphic | 1024×500 px PNG or JPG | user-action-pending |
| Phone screenshots | ≥2 screenshots | user-action-pending |
| Short description | ≤80 characters | user-action-pending |
| Full description | ≤4000 characters | user-action-pending |
| Category | Health & Fitness | user-action-pending |
| Contact email | Developer contact email | user-action-pending |

Listing copy note: Kilo launches lb-only (decision record in
`docs/current-state.md`, issue #435). Store descriptions should state weights
are tracked in pounds and must not promise kg/metric support.

---

## Build Requirements

| Item | Status | Notes |
|---|---|---|
| Production AAB via EAS | user-action-pending | `eas.json` production profile resolves to `buildType: "app-bundle"`, but EAS has no Android production build yet. Run `npm --prefix mobile run build:android:production` before Play upload. |
| Crash/error reporting env configured before AAB build | user-action-pending | Issue #434 adds Sentry. Set `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and sensitive `SENTRY_AUTH_TOKEN` in the build environment before the Play closed-testing AAB is created. |
| Play App Signing enrollment | user-action-pending | Must be enabled in Play Console before first release upload |
| Target API level ≥35 | **PASS — API 35** | See verification below |

### Production Build-Path Verification

Checked on 2026-07-06 for issue #431:

- `eas env:list --environment preview` and `eas env:list --environment production`
  both show the same `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, so preview and production resolve to the
  same Supabase project.
- `eas build:list --platform android --build-profile production --limit 5 --json`
  returned `[]`.
- `eas build:list --platform android --channel production --limit 5 --json`
  returned `[]`.
- `eas build:inspect --platform android --profile production --stage archive
  --output /tmp/kilo-issue-431-production-archive --force` completed and saved
  the project archive, verifying the production profile can resolve before a
  remote EAS build is started.
- `eas update:list --branch preview --limit 5 --json` shows current Android
  `preview-3` updates, latest `Merge issue 424 tester guidance` on 2026-07-06.
- `eas update:list --branch production --limit 5 --json` shows only one Android
  production update, `update with latest changes` from 2026-05-18, with
  `runtimeVersion` reported as `file:fingerprint`.

The remaining release blocker is user action: create and verify the production
Android AAB through EAS, then upload it to Play Console after Play App Signing
is ready.

### Target API Level Verification

**Command used:**
```sh
grep -r "targetSdkVersion" \
  node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin/src/main/kotlin/expo/modules/plugin/ExpoRootProjectPlugin.kt
```

**Output (relevant lines):**
```
val compileSdk = extra.setIfNotExist("compileSdkVersion") { Integer.parseInt(versionCatalogs.getVersionOrDefault("compileSdk", "35")) }
val targetSdk  = extra.setIfNotExist("targetSdkVersion")  { Integer.parseInt(versionCatalogs.getVersionOrDefault("targetSdk",  "35")) }
```

**Result:** Expo SDK 54 (installed version `~54.0.33`, introspected `sdkVersion: 54.0.0`) defaults to `targetSdkVersion 35` and `compileSdkVersion 35` via the Expo autolinking Gradle plugin. No explicit override exists in `mobile/app.json` or `mobile/eas.json`. Google requires new apps to target API 35 — this build config **passes**.
