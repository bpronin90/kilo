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

## Publishing a signed update

```sh
eas update \
  --platform android \
  --channel production \
  --private-key-path /path/to/private-key.pem \
  --message "describe the change"
```

Or via the npm script with the private key path appended:

```sh
npm --prefix mobile run publish:android -- \
  --private-key-path /path/to/private-key.pem \
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
