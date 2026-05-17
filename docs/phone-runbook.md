# Expo Go On Phone From WSL

Use this when the Kilo Expo app is run from WSL and loaded in Expo Go on a phone.

## TL;DR

1. In WSL, start Expo:

```bash
cd /home/benpronin/projects/kilo/mobile
npx expo start --clear
```

2. Copy the WSL Expo IP from:

```text
Metro waiting on exp://172.xx.xx.xx:8081
```

3. In Windows PowerShell, get the Windows Wi-Fi IP:

```powershell
ipconfig
```

4. In Windows PowerShell as Administrator, forward Windows port `8081` to the WSL IP:

```powershell
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=8081
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8081 connectaddress=172.xx.xx.xx connectport=8081
netsh advfirewall firewall add rule name="Expo 8081" dir=in action=allow protocol=TCP localport=8081
```

5. In Expo Go on the phone, manually open:

```text
exp://<windows-wifi-ip>:8081
```

If it stops working later, the WSL `172.x.x.x` IP probably changed. Re-run the port-forward commands with the new WSL IP.

## Normal Start

From WSL:

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

When the app changes, build a new APK and install it over the existing app:

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform android --profile preview
```

- Download the new `.apk` from the latest EAS build URL.
- Install it on the phone again. Android should treat this as an update as long
  as the package name stays the same and the signing is compatible.
- This flow does not provide automatic OTA updates. New shipped app changes
  require a new build and reinstall.
- Existing local app data will usually survive an in-place update, but that
  should still be verified when the change matters.

## Checking build status

```bash
eas build:list --platform android --limit 5
```

## Notes

- The app uses only local `AsyncStorage`; no backend or network connection is required at runtime.
- Subsequent builds reuse the same EAS project — no re-configuration needed.
- The `preview` profile intentionally omits signing setup, which is sufficient for local sideloading.

---

# Standalone iOS Build via EAS

Use this when you need an iOS build from the `mobile/` Expo app.

Two profiles are available:

- `ios-simulator` — builds a `.app` bundle for the iOS Simulator; no Apple Developer account required.
- `ios-device` — builds a release `.ipa` for real-device install; requires an Apple Developer account and active signing credentials.

## Prerequisites

- Expo account: `npx expo login`
- EAS CLI: `npm install -g eas-cli`
- For `ios-device`: Apple Developer Program membership and EAS-managed credentials or your own provisioning profile and certificate.

## Build for iOS Simulator

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform ios --profile ios-simulator
```

- Build runs on EAS cloud servers.
- When the build finishes, EAS prints a download URL for the `.app` archive.
- Unzip the archive and drag the `.app` into an open Simulator window, or use:

```bash
xcrun simctl install booted <path-to-app>
xcrun simctl launch booted com.benpronin.kilo
```

## Build for Real Device

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform ios --profile ios-device
```

- EAS will prompt for Apple Developer credentials on the first run and store managed credentials in the EAS dashboard.
- When the build finishes, EAS prints a download URL for the `.ipa`.
- Install via TestFlight, Apple Configurator 2, or Xcode Devices window.

## Checking build status

```bash
eas build:list --platform ios --limit 5
```

## Known blockers

- **Apple Developer account required for device builds.** The `ios-device` profile cannot produce a signed `.ipa` without valid credentials. Without an account, use `ios-simulator` only.
- **Simulator builds cannot run on a real device.** The `.app` from `ios-simulator` is an x86_64/arm64 simulator binary, not a signed device build.
- **No OTA update path.** New app changes require a new EAS build and reinstall, same as the Android path.
- **Mac not required.** EAS remote builds handle the Xcode toolchain on Apple silicon build workers; a local Mac is not needed.
