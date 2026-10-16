# Expo Development on a Phone

For developers installing Kilo Dev and connecting Metro, including WSL network troubleshooting. Build/distribution procedures are in [Mobile Builds](mobile-builds.md).

## Native Expo Workflow

Start with `npm run mobile:start`; `npm run mobile:android` launches Android directly.
For an installed development client, set both environment flags as shown below.

### Development client (on-device live loop)

**Expo Go cannot load this project.** The app targets Expo SDK 54 while Expo Go
ships only the current SDK's runtime, and `@sentry/react-native` — imported
unconditionally in `mobile/lib/errorReporting.js` — is not available in Expo Go.
`expo-updates` is inert there and `expo-notifications` is degraded. A prior SDK
upgrade attempt was reverted (see the `preview-2` / `preview-3` notes in
`mobile/app.config.js`), so raising the SDK to reach Expo Go is not an option.

Use the development client instead. Build it once:

```sh
cd mobile && eas build --profile development --platform android
```

Install the resulting APK, then start Metro against it:

```sh
cd mobile && APP_ENV=development EXPO_PUBLIC_APP_ENV=development npx expo start --dev-client
```

Saved edits reload on device immediately, with all real native modules present.
No `eas update` publish step is involved; the client connects directly to the
local Metro server.

The development build uses its own identity — `com.benpronin.kilo.dev`, shown as
**Kilo Dev** — so it installs alongside the preview app rather than replacing it.
Preview and production identifiers are unchanged. Keep both installed: the
development client is for iteration, the preview build remains the surface for
the [Installable Preview Smoke Checklist](manual-qa.md#installable-preview-smoke-checklist).

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
EXPO_PACKAGER_PROXY_URL=https://<your-static>.ngrok-free.dev APP_ENV=development EXPO_PUBLIC_APP_ENV=development npx expo start --dev-client
```

3. Open the development client and use its launcher URL for the reachable tunnel.
Do not use an `exp://` Expo Go link for this project.

4. If ngrok is unavailable, use the WSL port-forward fallback in `Working WSL Fix` below.

## Preferred Start

Two terminals from WSL. **`EXPO_PACKAGER_PROXY_URL` is required** — without it Metro
bakes its local `:8081` into the bundle URL and the JS bundle fails to load over
the tunnel (see the `ERR_NGROK_316` troubleshooting entry for why).

```bash
# Terminal 1: bind ngrok to your reserved static domain (no --url needed)
ngrok http 8081

# Terminal 2 (from mobile/): Metro, advertising the public tunnel URL
EXPO_PACKAGER_PROXY_URL=https://<your-static>.ngrok-free.dev APP_ENV=development EXPO_PUBLIC_APP_ENV=development npx expo start --dev-client
```

Then connect the development client to the tunnel using its launcher URL. This replaces
the old `npm run mobile:start:tunnel` / `expo start --tunnel` flow, which the free
ngrok plan can no longer serve.

## WSL Fallback Start

If tunnel does not work, start Expo without tunnel:

```bash
cd /home/benpronin/projects/kilo/mobile
APP_ENV=development EXPO_PUBLIC_APP_ENV=development npx expo start --dev-client --clear
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

6. Use this reachable Metro address in the development-client launcher (the old
`exp://` examples below describe the transport address, not an Expo Go runtime):

```text
exp://<windows-wifi-ip>:8081
```

Example:

```text
exp://192.168.1.50:8081
```

## If It Spins Forever

- Confirm phone and laptop are on the same Wi-Fi.
- Force-close Kilo Dev and reopen its launcher.
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
EXPO_PACKAGER_PROXY_URL=https://<your-static>.ngrok-free.dev APP_ENV=development EXPO_PUBLIC_APP_ENV=development npx expo start --dev-client
```

Then connect Kilo Dev to the reachable tunnel in its launcher.

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

Symptom: without tunneling, `APP_ENV=development EXPO_PUBLIC_APP_ENV=development npx expo start --dev-client` advertises `exp://172.x:8081`, a
WSL-internal IP the phone cannot reach, so scanning the QR never connects.

Fix: either enter `http://<windows-wifi-ip>:8081` in the development launcher, or start
Expo so the QR encodes the reachable Windows Wi-Fi IP:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=<windows-wifi-ip> APP_ENV=development EXPO_PUBLIC_APP_ENV=development npx expo start --dev-client
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
