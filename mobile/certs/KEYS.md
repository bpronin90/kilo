# Android Preview Testing

The supported Android testing workflow is:

1. **First install** (or after any native/config change): build and sideload a preview APK via EAS Build.
2. **JS-only changes**: publish an OTA update to the `preview` channel — no reinstall required.

## When to rebuild the APK

A fresh `eas build --platform android --profile preview` is required when:

- Native dependencies change (new packages with native modules, version bumps that include native changes)
- `app.json` config changes (permissions, plugins, splash, icon, `runtimeVersion`)
- `eas.json` build profile changes

## Build a preview APK

```sh
npm --prefix mobile run build:android:preview
```

Or directly:

```sh
eas build --platform android --profile preview
```

EAS builds the APK in the cloud and provides a download URL when complete.
Install the resulting `.apk` on a device via `adb install` or direct file transfer.

## Publish a JS-only OTA update (no reinstall needed)

After the preview APK is installed on device:

```sh
npm --prefix mobile run update:android:preview
```

Or directly:

```sh
eas update --platform android --channel preview
```

The installed preview build checks for updates on launch (`checkAutomatically: ON_LOAD`) and applies any published update matching its manual preview `runtimeVersion`. `PREVIEW_RUNTIME` in `mobile/app.config.js` is independent of `version` in `app.json`; it must advance in the same PR as a native module, Expo SDK/native dependency, or native config/plugin change. A build on an older runtime must be replaced with a fresh preview APK—an OTA cannot add its missing native code.

## No OTA code signing

Signed OTA updates are not in use. Do not add `codeSigningCertificate`, `codeSigningMetadata`, or `--private-key-path` — unsigned `eas update` is the correct path for this account.

## Manual validation flow

1. Build and install a preview APK (`build:android:preview`).
2. Make a JS-only change (e.g. update a label or color).
3. Publish the update (`update:android:preview`).
4. Relaunch the app on the device — the change should appear without reinstalling.
