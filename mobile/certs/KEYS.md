# Native Build And Update Integrity

Expo Updates are enabled for preview and production (#811). Updates are unsigned
on the current Expo plan, matching Kilo's established pre-#796 workflow. Protect
the Expo account with strong MFA: an account compromise could otherwise publish
replacement JavaScript outside store review. Native and security-sensitive
changes still ship through store/native builds.

## When to rebuild the APK

A fresh `eas build --platform android --profile preview` is required when:

- Native dependencies change (new packages with native modules, version bumps that include native changes)
- `app.json` config changes (permissions, plugins, splash, icon, `runtimeVersion`)
- `eas.json` build profile changes
- adding or changing the update-signing certificate or update-integrity posture

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

Issue #811 advances preview to runtime `preview-6` and restores EAS Update in
native config. Replace every preview-5 install once; later compatible JavaScript
and bundled-asset changes may use the preview channel without another APK.

## Publish a compatible preview update

```sh
npm --prefix mobile run update:android:preview
```

Publish only JavaScript or bundled-asset changes compatible with `preview-6`.
The production command targets only the production channel/environment and is a
separate release action; ordinary implementation does not publish it.

## Validate restored preview OTA delivery

1. Build and install one replacement `preview-6` APK with
   `npm --prefix mobile run build:android:preview`.
2. Make a harmless, runtime-compatible JavaScript-only test change and publish
   it with `npm --prefix mobile run update:android:preview`.
3. Force-close and relaunch the replacement app as needed for EAS Update to
   download and apply the bundle. Confirm the test change appears without
   installing another APK.
4. Confirm an older `preview-5` install does not receive the `preview-6` bundle.
5. Confirm the publication appears only on the `preview` channel and leaves the
   `production` channel unchanged.
