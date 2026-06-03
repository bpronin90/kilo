# Expo Go On Phone From WSL

Use this when the Kilo Expo app is run from WSL and loaded in Expo Go on a phone.

## TL;DR

Preferred path: use Expo tunnel.

1. From repo root in WSL, start Expo tunnel:

```bash
npx expo start --tunnel
```

2. Open the Expo Go link or scan the QR code shown in the terminal.

3. If tunnel is unavailable or unstable, use the WSL port-forward fallback in `Working WSL Fix` below.

## Preferred Start

From repo root in WSL:

```bash
npm run mobile:start:tunnel
```

Equivalent direct command from `mobile/`:

```bash
npx expo start --tunnel
```

This avoids the usual WSL-local-IP problem and is the default phone workflow for this repo.

## WSL Fallback Start

If tunnel does not work, start Expo without tunnel:

```bash
cd /home/benpronin/projects/kilo/mobile
npx expo start --clear
```

Expo will usually print something like:

```text
Metro waiting on exp://172.xx.xx.xx:8081
```

If that address is `172.x.x.x`, it is a WSL-internal IP and the phone usually cannot reach it directly.

## Working WSL Fix

1. Leave Expo running in WSL.
2. In Windows PowerShell, find the Windows Wi-Fi IPv4 address:

```powershell
ipconfig
```

3. In Windows PowerShell as Administrator, remove any old port forward:

```powershell
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=8081
```

4. In Windows PowerShell as Administrator, forward Windows port `8081` to the WSL Expo IP.
   Replace `172.xx.xx.xx` with the current WSL IP shown by Expo:

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8081 connectaddress=172.xx.xx.xx connectport=8081
```

5. In Windows PowerShell as Administrator, allow the port through the firewall:

```powershell
netsh advfirewall firewall add rule name="Expo 8081" dir=in action=allow protocol=TCP localport=8081
```

6. In Expo Go on the phone, manually open:

```text
exp://<windows-wifi-ip>:8081
```

Example:

```text
exp://192.168.1.50:8081
```

## If It Spins Forever

- Confirm phone and laptop are on the same Wi-Fi.
- Force-close Expo Go and reopen it.
- Verify Expo is still running in WSL.
- Check whether the WSL IP changed.

If WSL restarted, the `172.x.x.x` IP may change. When that happens:

1. Stop using the old forward.
2. Re-run the `portproxy delete` command.
3. Re-run the `portproxy add` command with the new WSL IP.

## Dependency Note

Do not use:

```bash
npm audit fix --force
```

for this workflow. It can rewrite Expo/Jest versions and break the repo's intended dependency set without fixing the WSL phone-connectivity problem.

---

# Standalone Android Build via EAS

Use this when you need an APK that runs on a phone without the dev machine being on.

## Prerequisites

- Expo account: `npx expo login`
- EAS CLI: `npm install -g eas-cli`

## One-time project linking (per account)

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

## Build APK

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform android --profile preview
```

- Uses the `preview` profile in `mobile/eas.json`, which produces a plain `.apk`.
- Build runs on EAS cloud servers — the laptop does not need to stay on.
- When the build finishes, EAS prints a download URL.

## Install on phone

1. Download the `.apk` from the EAS build URL (browser or `curl`).
2. Transfer to the phone (USB, Google Drive, email, etc.).
3. On the phone, open the `.apk` file and tap **Install**.
   - Enable "Install from unknown sources" in Android settings if prompted.

## Updating the app later

Use one of these two paths depending on what changed.

### OTA-safe update: JavaScript or assets only

If the installed Android build is already compatible and the change is limited
to JavaScript, styling, or bundled assets, publish an OTA update instead of
rebuilding:

```bash
cd /home/benpronin/projects/kilo/mobile
npm run update:android:preview
```

- `update:android:preview` targets the `preview` EAS Update channel.
- After publishing, fully close and reopen the installed app to let
  `expo-updates` fetch the new update on launch.

### Rebuild required: native-affecting change

If the change touches native runtime compatibility, build a new APK and install
it over the existing app:

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform android --profile preview
```

- Rebuild-required cases:
  - adding or upgrading a native module
  - changing Android native project files
  - changing `app.json` fields that affect native config, such as package,
    permissions, splash, or icons
  - bumping the `version` field in `app.json` (runtime version = app version
    under `runtimeVersion.policy: "appVersion"`, so a version bump creates a
    new runtime boundary that OTA updates cannot cross)
- The app uses `runtimeVersion.policy: "appVersion"`. Runtime version equals
  the `version` in `app.json`. OTA updates apply to any installed
  build sharing that version; a rebuild is only required for the cases above.
- Download the new `.apk` from the latest EAS build URL.
- Install it on the phone again. Android should treat this as an update as long
  as the package name stays the same and the signing is compatible.
- Existing local app data will usually survive an in-place update, but that
  should still be verified when the change matters.

## Checking build status

```bash
eas build:list --platform android --limit 5
```

## Notes

- The app uses only local `AsyncStorage`; no backend or network connection is required at runtime.
- Subsequent builds reuse the same EAS project — no re-configuration needed.
- The `preview` profile intentionally omits OTA code-signing setup. Use a preview APK for the first install, then use `npm run update:android:preview` for JS-only changes.

---

# Standalone iOS Build via EAS

Use this when you need an iOS build from the `mobile/` Expo app.

Two profiles are available:

- `ios-simulator` — builds a `.app` bundle for the iOS Simulator; no Apple Developer account required. **macOS required to use the artifact** — the EAS remote build runs without a Mac, but running the Simulator and `xcrun simctl` requires macOS with Xcode installed. Windows and Linux contributors can trigger the build but cannot use the resulting artifact locally.
- `ios-device` — builds an internal-distribution `.ipa` for direct real-device install; requires an Apple Developer account and device UDIDs registered in the Apple Developer portal.

## Prerequisites

- Expo account: `npx expo login`
- EAS CLI: `npm install -g eas-cli`
- For `ios-simulator`: macOS with Xcode installed to run the Simulator locally (EAS cloud handles the build itself on any OS).
- For `ios-device`: Apple Developer Program membership; target device UDIDs registered at [developer.apple.com/account/resources/devices](https://developer.apple.com/account/resources/devices); EAS will manage the ad hoc provisioning profile automatically.

## Build for iOS Simulator

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

## Build for Real Device (internal distribution)

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform ios --profile ios-device
```

- Uses `distribution: internal`, which produces an ad hoc `.ipa` installable directly from the EAS build URL — no App Store Connect or TestFlight submission required.
- EAS will prompt for Apple Developer credentials on the first run and store managed credentials in the EAS dashboard.
- The device must have its UDID registered in your Apple Developer portal before the build starts; EAS includes registered UDIDs in the ad hoc provisioning profile automatically.
- When the build finishes, EAS prints a direct download URL for the `.ipa`.
- **iOS 16+ Developer Mode required.** Internally distributed builds are treated as developer builds on iOS 16 and later. Before the `.ipa` will launch, go to **Settings → Privacy & Security → Developer Mode** on the device and enable it. The device will restart.

## Install on iPhone or iPad

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

## Updating the app later

When the app changes, build a new internal-distribution `.ipa` and install it on the device again:

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform ios --profile ios-device
```

- Open the latest build's install link from Safari on the same device and install the new build over the old one.
- If a new device needs access, register its UDID first and then create a fresh build. Existing `.ipa` files do not gain access to newly added devices.
- This flow does not provide automatic OTA updates. New shipped app changes require a new build and reinstall.
- Existing local app data will usually survive an in-place update, but that should still be verified when the change matters.

## Checking build status

```bash
eas build:list --platform ios --limit 5
```

## Known blockers

- **Apple Developer account required for device builds.** The `ios-device` profile cannot produce a signed `.ipa` without valid credentials. Without an account, use `ios-simulator` only.
- **Device UDID must be registered before building.** Internal distribution ties the provisioning profile to specific registered UDIDs. A device not registered at the time of the build cannot install that `.ipa`.
- **iOS 16+ requires Developer Mode enabled on the device.** Internal-distribution builds will not launch until Developer Mode is turned on in Settings → Privacy & Security → Developer Mode.
- **Simulator artifact requires macOS.** The EAS remote build itself runs on any OS, but installing and running the `.app` requires macOS with Xcode. Windows and Linux contributors cannot use the simulator artifact locally.
- **Simulator builds cannot run on a real device.** The `.app` from `ios-simulator` is a simulator binary, not a signed device build.
- **OTA not documented for this iOS flow.** Use a new EAS build and reinstall for now unless the repo adopts and validates an iOS OTA process separately.
