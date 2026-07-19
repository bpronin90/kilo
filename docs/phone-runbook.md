# Expo Go On Phone From WSL

Use this when the Kilo Expo app is run from WSL and loaded in Expo Go on a phone.

## TL;DR

> **`npx expo start --tunnel` no longer works on the free ngrok plan.** It demands
> a random `*.ngrok.app` domain that free accounts cannot bind (`ERR_NGROK_316`).
> Run ngrok yourself on your reserved static domain instead. See
> [`ERR_NGROK_316`](#err_ngrok_316--credential-acl-policy-does-not-permit-binding-this-name)
> for the full root cause.

Preferred path: self-run ngrok bound to your static domain, with Expo pointed at
the public tunnel URL.

1. Terminal 1 — bind ngrok (auto-uses your one reserved static domain):

```bash
ngrok http 8081
```

2. Terminal 2 — from `mobile/`, start Metro advertising the public tunnel URL:

```bash
EXPO_PACKAGER_PROXY_URL=https://<your-static>.ngrok-free.dev npx expo start
```

3. In Expo Go, **Enter URL manually**: `exp://<your-static>.ngrok-free.dev` (no port).

4. If ngrok is unavailable, use the WSL port-forward fallback in `Working WSL Fix` below.

## Preferred Start

Two terminals from WSL. **`EXPO_PACKAGER_PROXY_URL` is required** — without it Metro
bakes its local `:8081` into the bundle URL and the JS bundle fails to load over
the tunnel (see the `ERR_NGROK_316` troubleshooting entry for why).

```bash
# Terminal 1: bind ngrok to your reserved static domain (no --url needed)
ngrok http 8081

# Terminal 2 (from mobile/): Metro, advertising the public tunnel URL
EXPO_PACKAGER_PROXY_URL=https://<your-static>.ngrok-free.dev npx expo start
```

Then open `exp://<your-static>.ngrok-free.dev` in Expo Go (no port). This replaces
the old `npm run mobile:start:tunnel` / `expo start --tunnel` flow, which the free
ngrok plan can no longer serve.

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

## Troubleshooting

Symptom-indexed fixes for failures that have cost real debugging time. Find the
symptom, apply the fix, do not re-derive the chain.

### `ERR_NGROK_316` — "credential ACL policy does not permit binding this name"

Symptom: `npx expo start --tunnel` fails with `ERR_NGROK_316` and a line like
`Name: <random>.ngrok.app`.

**Root cause (free ngrok plan):** the free plan no longer grants random/ephemeral
domains — each account gets exactly **one reserved static domain**
(`*.ngrok-free.app` / `*.ngrok-free.dev`). But `expo start --tunnel` always asks
ngrok for a **random `*.ngrok.app`** name, which the free account is not allowed
to bind → `316`. This is a server-side ngrok policy change and does **not** appear
in the ngrok-agent or Expo changelogs, so a setup that worked for months can
break overnight with no local change. **No token swap fixes this** — the token is
fine; the plan simply can't bind a random name.

Confirm it is the plan, not the token: run the standalone agent with no requested
name. On a free account it silently substitutes your static domain instead of a
random one (proof the random grant is gone):

```bash
ngrok http 8081          # -> url=https://<your-static>.ngrok-free.dev, no 316
```

**Fix: stop using `expo start --tunnel`. Run ngrok yourself on your static domain
and point Expo at it via `EXPO_PACKAGER_PROXY_URL`.** Two terminals:

```bash
# Terminal 1 — bind ngrok (auto-uses your one static domain; no --url needed)
ngrok http 8081

# Terminal 2 (from mobile/) — start Metro advertising the PUBLIC tunnel URL
EXPO_PACKAGER_PROXY_URL=https://<your-static>.ngrok-free.dev npx expo start
```

Then in Expo Go open `exp://<your-static>.ngrok-free.dev` (no port).

`EXPO_PACKAGER_PROXY_URL` is required, not optional: without it Metro bakes its
local port into the manifest's bundle URL
(`https://<your-static>.ngrok-free.dev:8081/index.bundle`). The phone loads the
manifest over the tunnel (443) but then fails to fetch the JS bundle from `:8081`,
which the tunnel does not serve — the app connects, then hangs/errors loading
JavaScript. `EXPO_PACKAGER_PROXY_URL` overrides both host and port (https → 443),
so manifest and bundle both flow through the tunnel.

Verify the full chain from WSL before blaming the phone — bundle URL must have no
`:8081`, and the bundle itself must return `200`:

```bash
curl -s -H 'expo-platform: android' -H 'Accept: application/expo+json' \
  https://<your-static>.ngrok-free.dev/ | grep -o '"url":"[^"]*index.bundle[^"]*"'
```

Secondary cause (token, not plan): `@expo/ngrok` reads the **v2** config at
`~/.expo/ngrok.yml`, while the v3 standalone CLI reads
`~/.config/ngrok/ngrok.yml`. A stale token in the v2 file (re-issuing tokens via
the v3 CLI does not touch it) can surface as `ERR_NGROK_108` (session limit) or a
genuinely ACL-restricted token. Check for drift and sync if needed:

```bash
diff <(grep -i authtoken ~/.expo/ngrok.yml) \
     <(grep -i authtoken ~/.config/ngrok/ngrok.yml)
printf 'version: "2"\nauthtoken: YOUR_TOKEN\n' > ~/.expo/ngrok.yml
```

### "localhost works but LAN doesn't" — WSL port-forward fallback gotchas

When using the `netsh portproxy` fallback in `Working WSL Fix`, these silently
break the forward:

- **`iphlpsvc` (Windows IP Helper) must be running**, or `netsh portproxy`
  silently no-ops. Verify it is started before trusting any portproxy rule.
- **WSL2 auto-forwards localhost as IPv6 `[::1]:8081` only.** `curl localhost:8081`
  on Windows can succeed while the LAN IP fails. Verify an IPv4 listener exists:

  ```powershell
  netstat -an | findstr :8081
  ```

  Look for a `0.0.0.0:8081 ... LISTENING` line. If only `[::1]:8081` appears, the
  LAN path is not actually forwarded.
- **The portproxy `connectaddress` is the WSL `172.x` IP, which changes on every
  WSL restart.** Re-add the rule with the fresh `hostname -I` (run in WSL); do
  not touch ngrok for this.
- **`netsh interface portproxy reset` wipes the rule.** Re-add it afterward.

### "QR doesn't connect" — QR encodes the unreachable WSL IP

Symptom: without tunneling, `npx expo start` advertises `exp://172.x:8081`, a
WSL-internal IP the phone cannot reach, so scanning the QR never connects.

Fix: either manually open `exp://<windows-wifi-ip>:8081` in Expo Go, or start
Expo so the QR encodes the reachable Windows Wi-Fi IP:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=<windows-wifi-ip> npx expo start
```

### `@react-native-community/datetimepicker` "should be updated" notice

The startup notice that `@react-native-community/datetimepicker` "should be
updated for best compatibility" is **benign**. Do **not** "fix" it with
`expo install --fix` — that churns the repo's intended dependency set. Leave it
as-is (see `Dependency Note` below).

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
  - manually bumping `PREVIEW_RUNTIME` in `mobile/app.config.js` (see
    [Preview runtime policy](#preview-runtime-policy) below)
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
- Preview builds use a stable manual runtime string (`preview-4`) rather than tracking `expo.version`. App version bumps do not create a new OTA boundary for preview. See [Preview runtime policy](#preview-runtime-policy) for when to bump this string.

---

# Production Android Release & Updates (Play Store)

Use this for the app that ships through Google Play (production channel). This
path is separate from the preview APK flow above: production builds are `.aab`
app bundles distributed only through Play Console, and they use
`runtimeVersion.policy: "appVersion"` instead of the stable preview runtime
string.

## Build & upload the production AAB

```bash
# from the repo root
npm --prefix mobile run build:android:production
```

- Uses the `production` profile in `mobile/eas.json`: app-bundle output,
  `production` update channel, `autoIncrement` for the Android version code.
- Download the `.aab` from the EAS build page, then upload it in Play Console
  (Test and release → the target track → Create release). New AABs go through
  Google review before rollout.

## Push an update to the production app

Decision rule — pick the path by what changed:

| Change | Path |
|---|---|
| JS/styling/asset change only, **no version bump** | Production OTA update (below) |
| App version bump (`package.json` → synced via `scripts/sync-version.mjs`) | New AAB + Play Console release |
| Native change (module, native config, permissions, icons, Expo SDK) | New AAB + Play Console release |

### Production OTA update (JS/assets only, same app version)

```bash
# from the repo root
npm --prefix mobile run update:android:production
```

- Publishes to the `production` EAS Update channel.
- Installed apps fetch the update on next cold launch (fully close and reopen).
- **Only reaches installs whose app version matches the version the update is
  published against.** Production uses `runtimeVersion.policy: "appVersion"`,
  so every app version bump is a new OTA boundary — an update published at
  `0.88.0` never reaches phones still running the `0.87.x` AAB.
- Requires a compatible production AAB to already be live; do not publish
  production OTA updates before the first production AAB is uploaded and
  verified.

### New AAB release (version bump or native change)

1. Bump the canonical version in root `package.json` (if applicable) and run
   `node scripts/sync-version.mjs` so `mobile/package.json` and
   `mobile/app.json` match.
2. `npm --prefix mobile run build:android:production`
3. Upload the new `.aab` in Play Console on the same track → roll out (goes
   through Google review).
4. After rollout, JS-only OTA updates flow again for that version via
   `update:android:production`.

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
- **OTA not documented for this iOS flow.** Use a new EAS build and reinstall for now unless the repo adopts and validates an iOS OTA process separately. Preview builds share the same stable runtime string (`preview-4`), so the runtime boundary won't shift on version bumps when OTA is later enabled here.

---

# Preview Runtime Policy

Preview builds use a **stable manual runtime string** (`preview-4`) instead of
tracking `expo.version`. This means app version bumps do not create a new OTA
compatibility boundary for the `preview` channel. After a one-time rebuild onto
the new runtime, all subsequent JS-only preview OTA updates flow without
rebuilding.

## How it works

`mobile/app.config.js` sets `runtimeVersion` dynamically:

- Build/update env `APP_ENV=preview` → `runtimeVersion: "preview-4"`
- Production builds (no `APP_ENV`) → `runtimeVersion: { policy: "appVersion" }`

All three preview EAS build profiles (`preview`, `ios-simulator`, `ios-device`)
set `APP_ENV=preview` via `eas.json`. The `update:android:preview` and
`update:ios:preview` npm scripts also set `APP_ENV=preview` so bundled OTA
updates carry the same runtime value as the installed build.

## Recovery after a runtime bump

Installed preview builds on an older manual runtime (for example, `preview-3`)
must not receive an OTA published for `preview-4`. They can lack native code
required by the update, and an OTA cannot repair that mismatch. Build and install
a fresh preview APK before publishing or validating JS-only updates:

```bash
cd /home/benpronin/projects/kilo/mobile
eas build --platform android --profile preview
```

Install the new APK over the old build (or reinstall it). After that, all
JS-only preview updates on the new runtime flow OTA.

## JS-only preview update (normal path after migration)

```bash
cd /home/benpronin/projects/kilo/mobile
npm run update:android:preview
```

No rebuild required.

## When to bump the preview runtime

Bump `PREVIEW_RUNTIME` in `mobile/app.config.js` only when a native-affecting
change makes existing installed preview builds incompatible:

- adding or removing a native module
- changing Android/iOS native project files
- changing native config or an Expo config plugin (including `app.json` fields
  such as package, permissions, splash, or icons)
- updating the Expo SDK or any native dependency

Advance the constant in the same PR (for example, `"preview-3"` →
`"preview-4"`), then create and distribute a new preview build. Devices still
on the old runtime must be reinstalled; an OTA cannot add their missing native
code.

Do **not** bump the preview runtime for JS-only changes, styling updates,
dependency upgrades that are pure JS, or app version bumps.
