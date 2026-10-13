# Native Build And Update Integrity

Expo Updates are enabled for preview and production (#811). The trust boundary
is explicit (#1233): **production OTA updates are signed; preview, iOS
simulator, iOS device, and development stay unsigned and unchanged.**

A production binary embeds Kilo's update code-signing certificate. expo-updates
then accepts only manifests signed by the matching private key and rejects
unsigned or differently signed updates, falling back to the bundle it already
has. Access to the Expo account alone therefore cannot replace production
JavaScript: a publisher also needs Kilo's private key, which never enters Expo,
EAS, Git, or the app binary.

Preview remains a lower-trust test channel protected by Expo account MFA and
channel isolation. No preview key or certificate exists or is required.

## Production update signing

### What is private and what may be referenced

| Material | Classification | Where it lives |
| --- | --- | --- |
| `private-key.pem` | **Secret.** Signs production updates. | Offline in the owner's password manager (or an encrypted volume) only. Never in Git, EAS, CI, chat, or logs. |
| `public-key.pem` | Public, unused at runtime. | Kept beside the private key; no repo or EAS copy needed. |
| `certificate.pem` | Public. Embedded in production binaries. | EAS file variable `KILO_OTA_CODE_SIGNING_CERTIFICATE` in the `production` environment, plus the owner's local copy. Not committed. |
| Certificate SHA-256 fingerprint | Public. Identifies the intended certificate. | Recorded in the password-manager entry with the key. |

Git holds only configuration: `mobile/app.config.js` reads the certificate path
from `KILO_OTA_CODE_SIGNING_CERTIFICATE`, sets `updates.codeSigningCertificate`
and `codeSigningMetadata` (`keyid: main`, `alg: rsa-v1_5-sha256`), and never
reads the private key during a build. CI (`scripts/security-delivery.test.mjs`)
asserts no key or certificate file is tracked.

Signing applies when `APP_ENV=production` (set by the `production` EAS build
profile and the production update script) or `EAS_BUILD_PROFILE=production`.
Every other environment, including a local `expo start` with no `APP_ENV`,
resolves the same unsigned config as before #1233.

### Fail-closed behavior

- Production config resolution throws, and the EAS build or update stops, when
  `KILO_OTA_CODE_SIGNING_CERTIFICATE` is unset, unreadable, not an X.509 PEM
  certificate, contains private key material, is not RSA, is outside its
  validity period, or lacks the `codeSigning` extended key usage.
- `npm --prefix mobile run update:android:production` runs a preflight first.
  It also requires `KILO_OTA_CODE_SIGNING_PRIVATE_KEY` to be a readable,
  unencrypted PEM key whose public half matches the certificate. eas-cli then
  refuses to publish without `--private-key-path` or with a mismatched key.
- Errors name the variable only. File contents are never printed.
- A production install rejects any update that is unsigned or signed by a
  different key and keeps running its embedded or last valid bundle.

### One-time setup (outside Git)

1. **Plan prerequisite.** EAS end-to-end code signing requires an Expo plan
   that serves signed manifests (Production or Enterprise at the time of
   writing). The unsigned posture from #811 came from this limit. Without such
   a plan, signed production builds still fail closed: they run their embedded
   bundle and accept no OTA updates.
2. **Generate the key pair and certificate** on a trusted machine, into a
   directory outside the repository:

   ```sh
   cd mobile
   npx expo-updates codesigning:generate \
     --key-output-directory <private-dir>/keys \
     --certificate-output-directory <private-dir>/certs \
     --certificate-validity-duration-years 10 \
     --certificate-common-name "Kilo"
   ```

3. **Record the fingerprint:**
   `openssl x509 -in <private-dir>/certs/certificate.pem -noout -fingerprint -sha256`.
4. **Store** `private-key.pem`, `public-key.pem`, `certificate.pem`, and the
   fingerprint in the password manager. Keep an offline encrypted backup of
   the private key. Delete any other plaintext copies.
5. **Provide the certificate to EAS production builds:**

   ```sh
   eas env:create --environment production --name KILO_OTA_CODE_SIGNING_CERTIFICATE \
     --type file --value <private-dir>/certs/certificate.pem --visibility plaintext
   ```

   Do not create this variable in `preview` or `development`. Do not upload
   the private key to EAS.

6. Ship a new production store build (below). Signed production uses the
   runtime `<version>-signed` (for example `1.14.18-signed`) instead of the
   plain `appVersion` runtime, so signed and unsigned binaries never share a
   runtime. This matters because expo-updates does not re-verify cached
   updates: an unsigned OTA cached by an older install must not launch after
   an in-place upgrade to the signed binary. Installs built before #1233 stay
   unsigned until they update from the store, and they never receive signed
   bundles.

### Production build

```sh
export KILO_OTA_CODE_SIGNING_CERTIFICATE=<private-dir>/certs/certificate.pem  # for local config evaluation
npm --prefix mobile run build:android:production
```

On the EAS worker the certificate comes from the EAS file variable. Before
submitting, confirm that variable's certificate fingerprint matches the
recorded one; an Expo account compromise could swap it, and a build carrying
another certificate must not reach the store.

### Publishing a production update

Only as an explicit release action, after preview verification:

```sh
export KILO_OTA_CODE_SIGNING_CERTIFICATE=<private-dir>/certs/certificate.pem
export KILO_OTA_CODE_SIGNING_PRIVATE_KEY=<private-dir>/keys/private-key.pem
npm --prefix mobile run update:android:production
unset KILO_OTA_CODE_SIGNING_PRIVATE_KEY
```

Unlock the key only for the publish and remove its plaintext copy afterwards.

### Rotation

The certificate is native configuration, so rotation needs a store build.

1. Generate a new key pair and certificate (steps 2–4 above).
2. Replace the EAS variable with `eas env:update` (or `eas env:create --force`)
   in `production` only.
3. Bump the app version through the release workflow so the new certificate
   ships under a new `<version>-signed` runtime, then build and submit.
4. Sign updates for the new version with the new key. Keep the old key only
   to sign updates for older versions still installed, then destroy it once
   those versions are retired.

Rotate before certificate expiry: production builds stop resolving once the
configured certificate is outside its validity period.

### Compromise response

- **Expo account compromised, key safe:** production installs reject the
  attacker's updates. Reset the Expo password, MFA, and access tokens, then
  verify the EAS certificate variable fingerprint before any build. Preview
  installs are not protected; ship fresh preview builds if a preview update
  was tampered with.
- **Private key exposed:** an attacker still needs Expo publish access to use
  it. Treat it as urgent anyway. Secure the Expo account, rotate the key and
  certificate immediately (Rotation above), and ship the new store build. There
  is no remote revocation of an embedded certificate; installs on older
  versions trust the exposed key until they update. If a malicious update was
  served, publish a signed rollback (below) with the old key, which still
  works for those versions.

### Signed rollback to the embedded bundle

A rollback is a signed update like any other, so it needs the production
marker, the certificate the affected binaries embed, and its matching key.
Without `APP_ENV=production` the config has no certificate and eas-cli rejects
`--private-key-path`. From `mobile/`:

```sh
export KILO_OTA_CODE_SIGNING_CERTIFICATE=<certificate embedded in the affected version>
export KILO_OTA_CODE_SIGNING_PRIVATE_KEY=<matching private key>
APP_ENV=production node -e "try{require('./app.config.js').assertProductionUpdateSigning()}catch(e){console.error(e.message);process.exit(1)}" \
  && APP_ENV=production eas update:roll-back-to-embedded --platform android \
    --channel production --runtime-version <affected-version>-signed \
    --private-key-path "$KILO_OTA_CODE_SIGNING_PRIVATE_KEY"
unset KILO_OTA_CODE_SIGNING_PRIVATE_KEY
```

Repeat once per affected `<version>-signed` runtime.

### Lost signing material

The private key cannot be recovered or re-derived. Existing production installs
keep working on their current bundle but can receive no further OTA updates.
Generate new material, update the EAS variable, and ship a new store build;
production OTA resumes for that version. Losing only the certificate is
harmless: re-export it from the backup or regenerate it from the key.

## When to rebuild the APK

A fresh `eas build --platform android --profile preview` is required when:

- Native dependencies change (new packages with native modules, version bumps that include native changes)
- `app.json` config changes (permissions, plugins, splash, icon, `runtimeVersion`)
- `eas.json` build profile changes
- changing preview update-integrity posture (production signing changes need a production store build instead)

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
Preview updates are unsigned and need no signing material. The production
command targets only the production channel/environment, requires the signing
key, and is a separate release action; ordinary implementation does not publish
it.

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
