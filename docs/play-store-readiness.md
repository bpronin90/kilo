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
| Policy unfilled template blanks | blocked | Tracked separately; not in scope here |

### Data Safety Form
Declare under **Health & Fitness → Health info** for weight/body data, plus **Personal info → Email address** for auth identifiers.

| Item | Status | Notes |
|---|---|---|
| Data safety form submitted | user-action-pending | |
| Health info (weight/body) declared | user-action-pending | Collected; encrypted in transit |
| Email/auth identifiers declared | user-action-pending | Collected; encrypted in transit |
| Data deletion option declared | done | In-app deletion via account-delete Edge Function (#322); web deletion-request path on privacy page |
| "Encrypted in transit" checked | user-action-pending | True for all Supabase-backed data |

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

---

## Build Requirements

| Item | Status | Notes |
|---|---|---|
| Production AAB via EAS | done | `eas.json` production profile: `buildType: "app-bundle"` |
| Play App Signing enrollment | user-action-pending | Must be enabled in Play Console before first release upload |
| Target API level ≥35 | **PASS — API 35** | See verification below |

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
