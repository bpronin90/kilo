# Native Build And Update Integrity

Remote Expo Updates are disabled for preview and production until end-to-end
code signing and external key custody are provisioned. The supported testing
workflow is a replacement native build; do not publish an unsigned OTA update.

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

Issue #796 advances preview to runtime `preview-5`, disables Expo Updates in
native config, removes EAS channel bindings, and adds native dependencies.
Replace every preview-4 install with this fresh APK. Previously installed
preview-4 binaries cannot be retrofitted to reject unsigned updates, so do not
publish another bundle for that runtime.

## Re-enable OTA only with code signing

The repository does not contain a signing private key. An authorized release
operator must complete all of these steps before OTA publication returns:

1. Confirm the Expo account plan supports end-to-end EAS Update code signing.
2. Generate the key pair in a directory outside this repository. Store and back
   up the private key in the approved external secret manager or KMS; never
   commit it, upload it as a public build artifact, or paste it into an issue.
3. Commit only the public verification certificate and configure
   `updates.codeSigningCertificate` plus `updates.codeSigningMetadata`.
4. Advance the preview/production runtime boundary and create replacement native
   builds so the certificate is embedded in every accepting client.
5. Prove the replacement build rejects an unsigned manifest, then publish with
   the external private key path and verify a valid signed update is accepted.

Until every step passes, keep `updates.enabled: false`, keep build profiles
unbound from update channels, and ship changes only in new APK/AAB/IPA builds.

## Manual validation while OTA is disabled

1. Build and install a preview APK (`build:android:preview`).
2. Confirm the About screen reports the embedded bundle and a manual update
   check cannot download a remote bundle.
3. Confirm an update previously published to the old preview channel is not
   offered to the new build.
4. Make a JS-only test change and confirm it appears only after installing a new
   native build, not after relaunching the old build.
