# Play Store Readiness Checklist

Status: repository snapshot plus operator checklist. Verify time-sensitive
policy and every Play Console value before release.

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

Listing copy note: Kilo supports imperial and metric display preferences for
bodyweight and rendered lift values while storing canonical values in pounds.
Workout-note load input is still interpreted as pounds, so store copy must not
promise kilogram workout-note syntax.

---

## Build Requirements

Repository checks cannot prove EAS, Play App Signing, or Play Console state.
Verify those systems immediately before release.

| Item | Status | Notes |
|---|---|---|
| Production AAB via EAS | user-action-pending | Build `npm --prefix mobile run build:android:production` from the intended release head and inspect the resulting artifact. |
| Crash/error reporting build values | user-action-pending | Set `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and the sensitive `SENTRY_AUTH_TOKEN` in the build environment. |
| Play App Signing enrollment | user-action-pending | Confirm enrollment in Play Console before the first release upload. |
| Target API through August 30, 2026 | done | The current Expo SDK 54 dependency resolves Android target API 35. |
| Target API beginning August 31, 2026 | blocked | New apps and updates must target API 36 or higher; the current API 35 configuration is insufficient. |

### Target API Verification

The repository currently uses Expo SDK 54 (`~54.0.33`). Its installed Android
build tooling resolves `targetSdkVersion 35` and `compileSdkVersion 35`, with
no override in `mobile/app.json` or `mobile/eas.json`.

Google Play's
[Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
require phone and tablet apps submitted on or after August 31, 2026 to target
Android 16 / API 36 or higher. Before a submission on or after that date:

1. move the project to a supported Expo/native configuration that targets API
   36 or higher;
2. build a new production AAB;
3. inspect the generated artifact's target SDK; and
4. upload only after Play Console accepts the artifact without a target-level
   warning.

Do not infer the target SDK from `app.json` alone; verify the generated Android
artifact.
