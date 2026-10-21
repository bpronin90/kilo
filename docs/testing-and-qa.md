# Testing And QA

For contributors and testers choosing a verification task.

| Task | Owner |
|---|---|
| Run targeted tests or fix isolation | [Automated Tests](testing/automated-tests.md) |
| Assess coverage and profiling evidence | [Test Coverage](testing/test-coverage.md) |
| Diagnose a required check | [CI Gates](testing/ci-gates.md) |
| Verify an installed app or browser | [Manual QA](testing/manual-qa.md) |
| Iterate on a phone | [Expo Development](operations/expo-development.md) |

The section links below preserve previous entry URLs.

## Native Expo Workflow

See [Native Expo Workflow](operations/expo-development.md#native-expo-workflow).

### Development client (on-device live loop)

See [Development client (on-device live loop)](operations/expo-development.md#development-client-on-device-live-loop).

## Running Automated Tests

See [Running Automated Tests](testing/automated-tests.md#running-automated-tests).

### Security-critical changes

See [Security-critical changes](testing/ci-gates.md#security-critical-changes).

## Dependency Audit Gate

See [Dependency Audit Gate](testing/ci-gates.md#dependency-audit-gate).

### Proactive dependency updates

See [Proactive dependency updates](testing/ci-gates.md#proactive-dependency-updates).

## Version Sync Gate

See [Version Sync Gate](testing/ci-gates.md#version-sync-gate).

## App File Line Limit

See [App File Line Limit](testing/ci-gates.md#app-file-line-limit).

### Production security monitoring

See [Production security monitoring](testing/automated-tests.md#production-security-monitoring).

### Cross-file test isolation: fake timers

See [Cross-file test isolation: fake timers](testing/automated-tests.md#cross-file-test-isolation-fake-timers).

### Cross-file test isolation: unmount renderers that schedule real timers

See [Cross-file test isolation: unmount renderers that schedule real timers](testing/automated-tests.md#cross-file-test-isolation-unmount-renderers-that-schedule-real-timers).

## Automated Coverage Inventory

See [Automated Coverage Inventory](testing/test-coverage.md#automated-coverage-inventory).

### Cloud sync cost regressions

See [Cloud sync cost regressions](testing/test-coverage.md#cloud-sync-cost-regressions).

### Home cold-launch latency (#809)

See [Home cold-launch latency (#809)](testing/test-coverage.md#home-cold-launch-latency-809).

### Device-key validation off the cold-launch path (#1364)

See [Device-key validation off the cold-launch path (#1364)](testing/test-coverage.md#device-key-validation-off-the-cold-launch-path-1364).

### Local-first startup (#1366)

See [Local-first startup (#1366)](testing/test-coverage.md#local-first-startup-1366).

### Persisted parser cache and sync fan-out (#813)

See [Persisted parser cache and sync fan-out (#813)](testing/test-coverage.md#persisted-parser-cache-and-sync-fan-out-813).

### Residual cold-launch lag: duplicated hydration reads (#818)

See [Residual cold-launch lag: duplicated hydration reads (#818)](testing/test-coverage.md#residual-cold-launch-lag-duplicated-hydration-reads-818).

### Home first-paint read overlap (#984)

See [Home first-paint read overlap (#984)](testing/test-coverage.md#home-first-paint-read-overlap-984).

## Coverage Gaps

See [Coverage Gaps](testing/test-coverage.md#coverage-gaps).

## Android Edge-to-Edge Device Matrix

See [Android Edge-to-Edge Device Matrix](testing/manual-qa.md#android-edge-to-edge-device-matrix).

## Large-Screen and Resizing Matrix (#1126)

See [Large-Screen and Resizing Matrix (#1126)](testing/manual-qa.md#large-screen-and-resizing-matrix-1126).

## Installable Preview Smoke Checklist

See [Installable Preview Smoke Checklist](testing/manual-qa.md#installable-preview-smoke-checklist).

## Web Export Smoke Check

See [Web Export Smoke Check](testing/manual-qa.md#web-export-smoke-check).

### Automated pre-flight (`web:smoke`)

See [Automated pre-flight (`web:smoke`)](testing/manual-qa.md#automated-pre-flight-websmoke).

### Required browser + local-data boot verification (human)

See [Required browser + local-data boot verification (human)](testing/manual-qa.md#required-browser--local-data-boot-verification-human).

### Static hosting note

See [Static hosting note](testing/manual-qa.md#static-hosting-note).

## Android Restore Credentials Migration/Restore Test Flow

See [Android Restore Credentials Migration/Restore Test Flow](testing/manual-qa.md#android-restore-credentials-migrationrestore-test-flow).

## Google Play 2027 Memory and DEX Optimization (#1134)

See [Google Play 2027 Memory and DEX Optimization (#1134)](operations/play-store-readiness.md#google-play-2027-memory-and-dex-optimization-1134).

## Expo SDK 58 Upgrade Verification (#1546)

Toolchain: Expo SDK 58.0.16, React Native 0.88.0, React 19.3.0, Jest 30 /
jest-expo 58. A clean `expo prebuild --platform android` resolves AGP 9.2.1,
Gradle 9.4.1, and Kotlin 2.2.0 with `android.builtInKotlin=false` and
`android.newDsl=false`; the release buildType uses
`proguard-android-optimize.txt` and both #1176/#1455 keep rules are emitted.
References: [RN 0.87 (AGP 9)](https://reactnative.dev/blog/2026/08/11/react-native-0.87),
[Expo SDK 58](https://expo.dev/changelog/sdk-58).

Runtime and rollout: preview binaries use `preview-14`; signed production uses
`<version>-sdk58-signed`, so no SDK 58 bundle can reach an SDK 54 binary of the
same version (those use `<version>-signed`). Preview and production installs
need a fresh native build; JavaScript cannot repair an older binary.

Release-APK emulator smoke, 2026-10-21. EAS preview build
`a99b6450-8f0d-4aa9-9e02-9a3a6290dfc0` (runtime `preview-14`, commit
`22812152`), APK SHA-256
`1b7f015da1bada4b1cb057fd934df9bc08eb8c86d62b184e641e03771216f642`. Emulator
37.2.12, Android 15 (API 35, google_apis x86_64), Pixel 7 profile 1080×2400,
light, default font. Baseline: preview-13 build `bae54fd8` (SDK 54, commit
`5d22e00d`) installed first, seeded with two weigh-ins and a "Smoke Day"
routine, then preview-14 installed over it with `adb install -r` (same
`firstInstallTime`, data kept). Screenshots are in the local checkout under
`.visual-evidence/1546/`.

| Scenario | Steps | Result |
| --- | --- | --- |
| Cold launch | `am force-stop`; `am start -W` | Pass: 5.6 s first launch after upgrade, no fatal/JS errors in logcat; native splash matches SDK 54 (`new-11-native-splash.png`). |
| Existing data + SecureStore | Read baseline data after upgrade | Pass: 182.4 lb weigh-in and "Smoke Day" routine decrypt with the SecureStore device key (`new-01-cold-launch.png`); no `EncryptedStorageError`. |
| Navigation | Home, Weight, Analytics, More, Log | Pass: every tab renders with icons (`new-nav-*.png`). |
| Workout save/reload | Make routine current, append `140 5,5`, Done, force-stop, relaunch | Pass: new session persists across process restart (`new-03`, `new-04`). |
| Notification permission denied | Enable weigh-in reminder, "Don't allow" | Pass: toggle stays off, "Notifications are blocked" shown, no alarm registered (`new-06`). |
| Notification scheduling | Grant `POST_NOTIFICATIONS`, enable reminder | Pass: `expo.modules.notifications` RTC_WAKEUP alarm for 08:00 next day; no `NotSerializableException` (`new-07`). |
| Scheduling across restart | Force-stop + reboot, then launch; plain reboot without launch | Pass: launch reconciles the alarm after a force-stopped boot; a plain reboot restores it from the serialized store before launch. |
| System appearance | Dark, then System, then OS night mode on/off | Pass: System follows OS light/dark live, same process, no crash (`new-08`–`new-10`). |

Production profile build: EAS `b09f72af-ae93-46e9-81af-888e27fc9c7c`
(`npm run build:android:production` with the local certificate for config
evaluation), commit `03e77f9f`, version 1.16.48, versionCode 19, AAB SHA-256
`c4b2c03e4541651305599951fa0f5bbc88d09141ec0422f3215181225a318e57`. The AAB
embeds runtime `1.16.48-sdk58-signed` and the `CN=Kilo` code-signing
certificate (SHA-256 `CA:EB:C3:E6:99:99:D9:F0:23:AE:BD:6B:D6:8D:60:A4:AB:16:6C:5C:F9:F7:20:BD:83:76:50:F5:E5:C2:71:A9`;
compare with the password-manager record before any submission) with metadata
`keyid main` / `rsa-v1_5-sha256`. Not submitted. `r8.json` thresholds and
optimized resource shrinking remain #1167's acceptance.

Signed-in session persistence, same emulator and APKs, disposable test
account (no tokens recorded). Identity source is the Supabase auth user ID;
the session persists through `auth.storage` = the chunked SecureStore adapter
(`mobile/lib/supabaseClient.js`, `persistSession: true`), and the local data
owner marker records that user ID. Sign-out (`mobile/hooks/useAuthSession.js`)
revokes the Android restore key, calls `auth.signOut()` (removes the stored
session chunks) and clears in-memory session state. Screenshots: `ac5-*.png`.

| Scenario | Steps | Result |
| --- | --- | --- |
| Upgrade keeps session | Clean preview-13 install, sign in (dismiss first-sign-in prompt), force-stop, `adb install -r` preview-14, launch | Pass: Account shows "Signed in as" the same account with no re-login (`ac5-01`, `ac5-02`). First-sign-in prompt reappears because the owner marker was unclaimed; by design (`dismissOwnershipPrompt`). |
| Authenticated operation | "Download My Account's Data" on SDK 58 | Pass: server data pulled down (`ac5-03`). |
| Same user ID restored | Force-stop, relaunch | Pass: no ownership prompt, so the restored session user ID equals the stored owner (`owner === userId` path); still signed in (`ac5-04`). |
| Network unavailable | Airplane mode, force-stop, cold launch, Export Account Data | Pass: local data renders; server fetch fails visibly ("fetch failed: … UnknownHostException"), no false success (`ac5-06`). |
| Recovery | Network back, relaunch | Pass: "Server acknowledged. Up to date" / "Server-confirmed pass complete" (`ac5-07-online-sync-complete`). |
| Logout invalidation | Sign Out, force-stop, relaunch | Pass: Account shows SIGN IN; no session or ownership prompt restored (`ac5-09`, `ac5-10`). |

Observation: an Export Account Data request started right after leaving
airplane mode stayed "Working…" in that process (likely a stale connection; RN's
OkHttp client has no read timeout). After relaunch the retry reached the
server and returned the export rate limit ("Too Many Requests", `ac5-08`).
Not compared against SDK 54; no data or auth-state impact.
