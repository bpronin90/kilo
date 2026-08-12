# Mobile Development And Build Runbook

Status: current operator and developer runbook for WSL/Expo connectivity, EAS
builds, device installation, and preview-runtime policy. Testing expectations
live in `docs/testing-and-qa.md`; Play Console status lives in
`docs/play-store-readiness.md`.

The first section covers running Kilo from WSL in Expo Go. Later sections cover
standalone Android and iOS artifacts.

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

Remote EAS Update publication is disabled. The `update:*` scripts fail
intentionally and must not be bypassed.

Build a replacement preview artifact for every update:

```sh
npm --prefix mobile run build:android:preview
```

Install the new APK over the existing app when package name and signing identity
are compatible. Confirm local data survives when the release depends on
in-place-update behavior. Native-affecting changes additionally require a
preview-runtime bump as described below.

### Checking Build Status

```bash
eas build:list --platform android --limit 5
```

### Notes

- The app uses only local `AsyncStorage`; no backend or network connection is required at runtime.
- Subsequent builds reuse the same EAS project — no re-configuration needed.
- The `preview` profile intentionally disables remote updates. Distribute a new
  preview APK for every change.
- Preview builds use the manual runtime string documented in
  [Preview Runtime Policy](#preview-runtime-policy). Read the value from
  `mobile/app.config.js`; do not copy an older runtime string forward.

---

## Production Android Release And Updates

Use this for the app that ships through Google Play (production channel). This
path is separate from the preview APK flow above: production builds are `.aab`
app bundles distributed only through Play Console, and they use
`runtimeVersion.policy: "appVersion"` instead of the stable preview runtime
string.

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

Remote EAS Update publication is disabled for production as well as preview.
Every production change ships through a new AAB:

1. If the application version changes, update the canonical root version through
   the release workflow and synchronize the mobile version fields.
2. Run `npm --prefix mobile run build:android:production`.
3. Upload the resulting AAB to the intended Play Console track.
4. Complete review and rollout, then verify the installed artifact.

Do not run or bypass `update:android:production`; it is intentionally wired to
the blocked-update script.

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
- **Remote updates are disabled for this iOS flow.** Use a new EAS build and
  reinstall. Re-enabling updates requires the signed-update procedure in
  [Preview Runtime Policy](#preview-runtime-policy).

---

## Preview Runtime Policy

Preview builds use the manual runtime string `preview-5` from
`mobile/app.config.js`. The runtime identifies native compatibility across
preview artifacts; it is not permission to publish an OTA update.

Remote updates are currently fail-closed:

- `updates.enabled` is false in replacement builds.
- No preview or production update channel is bound.
- Every `update:*` package script exits with a blocked message.
- A private update-signing key must not be stored in this repository.

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
that leaves native compatibility unchanged. OTA remains blocked either way, so
those changes still ship in a replacement artifact.

### Re-Enabling Remote Updates

Re-enable EAS Update only through an explicit security change that:

1. creates and keeps the signing private key outside source control;
2. embeds the matching public certificate and code-signing metadata in a new
   runtime;
3. ships replacement native builds with signed-update enforcement;
4. proves those builds reject unsigned or incorrectly signed manifests; and
5. replaces the blocked package scripts with reviewed publish commands.

Until all five conditions are met, build replacement native artifacts and do
not publish remote updates.
