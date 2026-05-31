# OTA Code Signing Keys

## What is checked in

`certificate.crt` — the public X.509 certificate (RSA 2048, self-signed, valid
3 years from 2026-05-31, expires 2029-05-30). This file is intentionally committed.
It is embedded in the native app bundle at build time and used on-device to verify
that each downloaded OTA update was signed by the matching private key.

## What is NOT checked in

The private key (`private-key.pem`) must never be committed. Store it in one of:

- A CI/CD secrets store (preferred — see below)
- A local secure location outside the repo as a fallback (e.g. `~/.kilo/ota-private-key.pem`)

The private key was generated alongside this certificate and is needed only
when publishing a signed OTA update.

## Private key storage policy

**Preferred: CI secrets store.**
Store `private-key.pem` as an encrypted CI secret (e.g. a GitHub Actions encrypted
secret named `OTA_PRIVATE_KEY`). Write it to a temp file at publish time:

```yaml
- name: Write OTA signing key
  run: echo "${{ secrets.OTA_PRIVATE_KEY }}" > /tmp/ota-private-key.pem
  env:
    OTA_PRIVATE_KEY: ${{ secrets.OTA_PRIVATE_KEY }}
```

Do not store the key in a developer home directory on a shared machine or check it
into any version-control system, including private forks.

**Key rotation on team changes.**
Rotate the key pair whenever a team member who had access to the private key departs.
Generate a new key pair, commit the replacement cert, submit a new native build, and
notify users to update via the app store.

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

## Key-compromise incident response

If the private key is lost, stolen, or potentially exposed:

1. **Generate a new key pair immediately.**
   ```sh
   openssl req -x509 -newkey rsa:2048 \
     -keyout /tmp/ota-private-key-new.pem \
     -out /tmp/certificate-new.crt \
     -days 1095 -nodes \
     -subj "/CN=kilo-ota-update-signing/O=Kilo/C=US"
   ```
2. **Replace the cert in the repo.**
   Copy `/tmp/certificate-new.crt` to `mobile/certs/certificate.crt` and commit.
3. **Update the CI secret.**
   Replace the `OTA_PRIVATE_KEY` encrypted secret with the new private key content.
   Delete the old key from any local copies immediately.
4. **Submit a new native build.**
   The old cert is embedded in previously installed builds. Those installs will reject
   OTA updates signed by the new key until the user installs the new native build.
   Submit to the Play Store / App Store and set the minimum required version if possible.
5. **Notify users.**
   Post a release note explaining that users must update via the app store to continue
   receiving OTA updates. Any install still running the old native build is isolated —
   it can no longer receive updates signed by the new key, but it is not actively
   compromised; the attacker's window for pushing malicious OTA updates to those
   installs persists until they reinstall from the new native build.
6. **Document the incident.**
   Record what was exposed, when, and how the rotation was performed in the repo's
   incident log or a private security note.

## Cert rotation schedule

Current cert expires **2029-05-30**. Renew before expiry using the same procedure as
key-compromise steps 1–3 above (no user notification needed if the key is not compromised,
but a new native build is still required to embed the new cert).
