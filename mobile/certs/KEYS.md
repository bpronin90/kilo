# Android Preview Testing

The supported Android testing workflow is preview APK sideloading via EAS Build.

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

## No OTA code signing

Signed OTA updates are not in use on this account. The `updates` block in
`mobile/app.json` retains the EAS project URL for potential future use but
does not configure code signing. Do not add `codeSigningCertificate` or
`codeSigningMetadata` without first verifying the private key is available
and the account plan supports signed OTA.
