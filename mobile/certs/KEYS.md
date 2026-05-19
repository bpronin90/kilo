# OTA Code Signing Keys

## What is checked in

`certificate.crt` — the public X.509 certificate (RSA 2048, self-signed, valid
10 years from 2026-05-18). This file is intentionally committed. It is embedded
in the native app bundle at build time and used on-device to verify that each
downloaded OTA update was signed by the matching private key.

## What is NOT checked in

The private key (`private-key.pem`) must never be committed. Store it in one of:

- A local secure location outside the repo (e.g. `~/.kilo/ota-private-key.pem`)
- A CI/CD secrets store (e.g. GitHub Actions secret, EAS Secret)

The private key was generated alongside this certificate and is needed only
when publishing a signed OTA update.

## Environment variable

Both publish scripts read the private key path from `EXPO_OTA_PRIVATE_KEY_PATH`.
Set this before running any publish command:

```sh
export EXPO_OTA_PRIVATE_KEY_PATH=~/.kilo/ota-private-key.pem
```

The value must be an absolute or shell-expanded path to the private key file.
The key itself must not be committed or embedded in any config file.

## Publishing a signed production update

```sh
export EXPO_OTA_PRIVATE_KEY_PATH=~/.kilo/ota-private-key.pem
npm --prefix mobile run publish:android -- --message "describe the change"
```

Equivalent direct invocation:

```sh
eas update \
  --platform android \
  --channel production \
  --private-key-path ~/.kilo/ota-private-key.pem \
  --message "describe the change"
```

## Publishing a signed preview update

```sh
export EXPO_OTA_PRIVATE_KEY_PATH=~/.kilo/ota-private-key.pem
npm --prefix mobile run publish:android:preview -- --message "describe the change"
```

Equivalent direct invocation:

```sh
eas update \
  --platform android \
  --channel preview \
  --private-key-path ~/.kilo/ota-private-key.pem \
  --message "describe the change"
```

EAS Update signs the update manifest with the private key. The app verifies the
signature against `certificate.crt` before applying the update.

## Regenerating the key pair

If the private key is lost:

1. Generate a new key pair and certificate.
2. Replace `certificate.crt` in this directory.
3. Submit a new native build — the old certificate embedded in previously
   installed builds will no longer match and those installs will reject updates
   signed by the new key until the app is reinstalled from the new build.
