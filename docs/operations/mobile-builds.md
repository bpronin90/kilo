# Native Builds and Update Delivery

For release operators producing Android/iOS artifacts and choosing a compatible update path. Read runtime values from `mobile/app.config.js`, never an old issue snapshot. Key custody remains in [KEYS.md](../../mobile/certs/KEYS.md).

## Standalone Android Build Via EAS

Use this when you need an APK that runs on a phone without the dev machine being on.

### Prerequisites

- Expo account: `npx expo login`
- EAS CLI: `npm install -g eas-cli`

### One-Time Project Linking

```bash
cd /home/benpronin/projects/kilo/mobile
eas build:configure
```

This links the project to your Expo account and writes `extra.eas.projectId` into `mobile/app.json`.
**After running, commit the updated `app.json`** so the linked project ID is checked in and the build path is reproducible for all contributors:

```bash
git add mobile/app.json
git commit -m "chore(mobile): add EAS projectId from eas build:configure"
```

Skip this step if `extra.eas.projectId` is already present in `mobile/app.json`.

### Build APK

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform android --profile preview
```

- Uses the `preview` profile in `mobile/eas.json`, which produces a plain `.apk`.
- Build runs on EAS cloud servers — the laptop does not need to stay on.
- When the build finishes, EAS prints a download URL.

### Install On Phone

1. Download the `.apk` from the EAS build URL (browser or `curl`).
2. Transfer to the phone (USB, Google Drive, email, etc.).
3. On the phone, open the `.apk` file and tap **Install**.
   - Enable "Install from unknown sources" in Android settings if prompted.

### Updating The App Later

Build a replacement preview artifact after native/configuration changes:

```sh
npm --prefix mobile run build:android:preview
```

Install the new APK over the existing app when package name and signing identity
are compatible. Confirm local data survives when the release depends on
in-place-update behavior. Native-affecting changes additionally require a
preview-runtime bump as described below.

For a compatible JavaScript or bundled-asset change, publish to preview:

```sh
npm --prefix mobile run update:android:preview
```

### Checking Build Status

```bash
eas build:list --platform android --limit 5
```

### Notes

- Local-only use requires no backend. Configured cloud sync and account operations use Supabase; update delivery can also use the network.
- Subsequent builds reuse the same EAS project — no re-configuration needed.
- The `preview` profile receives only the `preview` update channel.
- Preview builds use the manual runtime string documented in
  [Preview Runtime Policy](#preview-runtime-policy). Read the value from
  `mobile/app.config.js`; do not copy an older runtime string forward.

---

## Production Android Release And Updates

Use this for the app that ships through Google Play (production channel). This
path is separate from the preview APK flow above: production builds are `.aab`
app bundles distributed only through Play Console, and they use the signed
per-version runtime `<version>-sdk<N>-signed` (#1233, #1546) instead of the
stable preview runtime string. The Expo SDK major `<N>` keeps an SDK upgrade's
JavaScript off older binaries that share the app version; binaries built before
#1546 use `<version>-signed`.

### Build And Upload The Production AAB

```bash
# from the repo root
npm --prefix mobile run build:android:production
```

- Uses the `production` profile in `mobile/eas.json`: app-bundle output,
  `production` update channel, `autoIncrement` for the Android version code.
- Download the `.aab` from the EAS build page, then upload it in Play Console
  (Test and release → the target track → Create release). New AABs go through
  Google review before rollout.

### Updating Production

Native and runtime-incompatible production changes ship through a new AAB:

1. If the application version changes, update the canonical root version through
   the release workflow and synchronize the mobile version fields.
2. Run `npm --prefix mobile run build:android:production`.
3. Upload the resulting AAB to the intended Play Console track.
4. Complete review and rollout, then verify the installed artifact.

Compatible JavaScript-only production updates use
`npm --prefix mobile run update:android:production` as an explicit release
action after preview verification. Never use it during ordinary implementation.
Production builds and updates require the signing material described in
`mobile/certs/KEYS.md` and fail closed without it.

---

## Standalone iOS Build Via EAS

Use this when you need an iOS build from the `mobile/` Expo app.

Two profiles are available:

- `ios-simulator` — builds a `.app` bundle for the iOS Simulator; no Apple Developer account required. **macOS required to use the artifact** — the EAS remote build runs without a Mac, but running the Simulator and `xcrun simctl` requires macOS with Xcode installed. Windows and Linux contributors can trigger the build but cannot use the resulting artifact locally.
- `ios-device` — builds an internal-distribution `.ipa` for direct real-device install; requires an Apple Developer account and device UDIDs registered in the Apple Developer portal.

### Prerequisites

- Expo account: `npx expo login`
- EAS CLI: `npm install -g eas-cli`
- For `ios-simulator`: macOS with Xcode installed to run the Simulator locally (EAS cloud handles the build itself on any OS).
- For `ios-device`: Apple Developer Program membership; target device UDIDs registered at [developer.apple.com/account/resources/devices](https://developer.apple.com/account/resources/devices); EAS will manage the ad hoc provisioning profile automatically.

### Build For iOS Simulator

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform ios --profile ios-simulator
```

- Build runs on EAS cloud servers and can be triggered from any OS.
- When the build finishes, EAS prints a download URL for the `.app` archive.
- **macOS only from here:** unzip the archive and drag the `.app` into an open Simulator window, or use:

```bash
xcrun simctl install booted <path-to-app>
xcrun simctl launch booted com.benpronin.kilo
```

These commands require macOS with Xcode. They are not available on Windows or Linux.

### Build For Real Device (Internal Distribution)

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform ios --profile ios-device
```

- Uses `distribution: internal`, which produces an ad hoc `.ipa` installable directly from the EAS build URL — no App Store Connect or TestFlight submission required.
- EAS will prompt for Apple Developer credentials on the first run and store managed credentials in the EAS dashboard.
- The device must have its UDID registered in your Apple Developer portal before the build starts; EAS includes registered UDIDs in the ad hoc provisioning profile automatically.
- When the build finishes, EAS prints a direct download URL for the `.ipa`.
- **iOS 16+ Developer Mode required.** Internally distributed builds are treated as developer builds on iOS 16 and later. Before the `.ipa` will launch, go to **Settings → Privacy & Security → Developer Mode** on the device and enable it. The device will restart.

### Install On iPhone Or iPad

1. Open the finished build from the EAS build URL in a desktop browser or run:

```bash
eas build:list --platform ios --limit 5
```

2. Open the latest `ios-device` build details page and use its install link.
3. On the target iPhone or iPad, open the install link from Safari.
4. Tap the install prompt and allow iOS to download the app.
5. If iOS 16+ Developer Mode is not already enabled, try launching the app once, accept the prompt, then go to **Settings → Privacy & Security → Developer Mode** and turn it on. The device will restart.
6. After the restart, unlock the device, confirm **Turn On** for Developer Mode, enter the passcode if prompted, and launch the app again.

Alternative install paths:

- Connect the device to a Mac and install the `.ipa` with Apple Configurator 2.
- Connect the device to a Mac and install the `.ipa` from Xcode's **Devices and Simulators** window.

If the install link fails, re-check that the device UDID was registered before the build started. If it was added afterward, create a new `ios-device` build.

### Updating The App Later

When the app changes, build a new internal-distribution `.ipa` and install it on the device again:

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform ios --profile ios-device
```

- Open the latest build's install link from Safari on the same device and install the new build over the old one.
- If a new device needs access, register its UDID first and then create a fresh build. Existing `.ipa` files do not gain access to newly added devices.
- This flow does not provide automatic OTA updates. New shipped app changes require a new build and reinstall.
- Existing local app data will usually survive an in-place update, but that should still be verified when the change matters.

### Checking Build Status

```bash
eas build:list --platform ios --limit 5
```

### Known Blockers

- **Apple Developer account required for device builds.** The `ios-device` profile cannot produce a signed `.ipa` without valid credentials. Without an account, use `ios-simulator` only.
- **Device UDID must be registered before building.** Internal distribution ties the provisioning profile to specific registered UDIDs. A device not registered at the time of the build cannot install that `.ipa`.
- **iOS 16+ requires Developer Mode enabled on the device.** Internal-distribution builds will not launch until Developer Mode is turned on in Settings → Privacy & Security → Developer Mode.
- **Simulator artifact requires macOS.** The EAS remote build itself runs on any OS, but installing and running the `.app` requires macOS with Xcode. Windows and Linux contributors cannot use the simulator artifact locally.
- **Simulator builds cannot run on a real device.** The `.app` from `ios-simulator` is a simulator binary, not a signed device build.
- **Preview iOS builds receive only the preview channel.** Native changes still
  require a new build and reinstall.

---

## Preview Runtime Policy

Preview builds use the manual `PREVIEW_RUNTIME` value from
`mobile/app.config.js`. The runtime identifies native compatibility across
preview artifacts. Only compatible JavaScript and bundled-asset changes may be
published to that runtime.

### When To Bump The Preview Runtime

Advance `PREVIEW_RUNTIME` in the same change whenever an installed preview
would lack required native code or configuration, including:

- adding, removing, or upgrading a native module;
- updating Expo SDK or another native dependency;
- changing platform permissions, schemes, icons, plugins, or native project
  files;
- changing security behavior embedded in the native update client.

After a bump, create and distribute replacement preview artifacts. An older
installed runtime cannot be repaired by JavaScript.

Do not bump the runtime for a pure JavaScript, styling, or bundled-asset change
that leaves native compatibility unchanged; those changes may use OTA.

Production updates are signed and production installs reject anything else
(#1233); preview updates stay unsigned. Keep strong MFA enabled on the Expo
account, keep preview and production channels isolated, and use native store
builds for security-sensitive changes. Signing setup and key handling live in
`mobile/certs/KEYS.md`.

## OTA Update Delivery

`mobile/app.json` enables launch-time update checks. Production's native update
client embeds the signing certificate through `mobile/app.config.js` and rejects
unsigned or differently signed bundles. Preview, simulator and development
updates stay unsigned; strong Expo account MFA remains their delivery boundary.
Native and security-sensitive changes ship in replacement native builds.

The profile/channel, publication, runtime and key-custody rules are owned by the
build/update sections above and [Preview Runtime Policy](#preview-runtime-policy).
The disabled `preview-5` → unsigned `preview-6` transition is historical native
configuration: older clients remain isolated; it is not today's runtime value.

[Current State](../product/current-state.md#runtime-and-distribution) still records remote
publication blocked on signing-key custody. The presence of update scripts is
not evidence that custody is resolved. An authorized release operator must
resolve that prerequisite before publishing; no release is performed by this
refactor.
