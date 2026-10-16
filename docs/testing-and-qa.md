# Testing And QA

For contributors and testers choosing a verification task.

| Task | Owner |
|---|---|
| Run targeted tests or fix isolation | [Automated Tests](automated-tests.md) |
| Assess coverage and profiling evidence | [Test Coverage](test-coverage.md) |
| Diagnose a required check | [CI Gates](ci-gates.md) |
| Verify an installed app or browser | [Manual QA](manual-qa.md) |
| Iterate on a phone | [Expo Development](expo-development.md) |

The section links below preserve previous entry URLs.

## Native Expo Workflow

See [Native Expo Workflow](expo-development.md#native-expo-workflow).

### Development client (on-device live loop)

See [Development client (on-device live loop)](expo-development.md#development-client-on-device-live-loop).

## Running Automated Tests

See [Running Automated Tests](automated-tests.md#running-automated-tests).

### Security-critical changes

See [Security-critical changes](ci-gates.md#security-critical-changes).

## Dependency Audit Gate

See [Dependency Audit Gate](ci-gates.md#dependency-audit-gate).

### Proactive dependency updates

See [Proactive dependency updates](ci-gates.md#proactive-dependency-updates).

## Version Sync Gate

See [Version Sync Gate](ci-gates.md#version-sync-gate).

## App File Line Limit

See [App File Line Limit](ci-gates.md#app-file-line-limit).

### Production security monitoring

See [Production security monitoring](automated-tests.md#production-security-monitoring).

### Cross-file test isolation: fake timers

See [Cross-file test isolation: fake timers](automated-tests.md#cross-file-test-isolation-fake-timers).

### Cross-file test isolation: unmount renderers that schedule real timers

See [Cross-file test isolation: unmount renderers that schedule real timers](automated-tests.md#cross-file-test-isolation-unmount-renderers-that-schedule-real-timers).

## Automated Coverage Inventory

See [Automated Coverage Inventory](test-coverage.md#automated-coverage-inventory).

### Cloud sync cost regressions

See [Cloud sync cost regressions](test-coverage.md#cloud-sync-cost-regressions).

### Home cold-launch latency (#809)

See [Home cold-launch latency (#809)](test-coverage.md#home-cold-launch-latency-809).

### Device-key validation off the cold-launch path (#1364)

See [Device-key validation off the cold-launch path (#1364)](test-coverage.md#device-key-validation-off-the-cold-launch-path-1364).

### Local-first startup (#1366)

See [Local-first startup (#1366)](test-coverage.md#local-first-startup-1366).

### Persisted parser cache and sync fan-out (#813)

See [Persisted parser cache and sync fan-out (#813)](test-coverage.md#persisted-parser-cache-and-sync-fan-out-813).

### Residual cold-launch lag: duplicated hydration reads (#818)

See [Residual cold-launch lag: duplicated hydration reads (#818)](test-coverage.md#residual-cold-launch-lag-duplicated-hydration-reads-818).

### Home first-paint read overlap (#984)

See [Home first-paint read overlap (#984)](test-coverage.md#home-first-paint-read-overlap-984).

## Coverage Gaps

See [Coverage Gaps](test-coverage.md#coverage-gaps).

## Android Edge-to-Edge Device Matrix

See [Android Edge-to-Edge Device Matrix](manual-qa.md#android-edge-to-edge-device-matrix).

## Large-Screen and Resizing Matrix (#1126)

See [Large-Screen and Resizing Matrix (#1126)](manual-qa.md#large-screen-and-resizing-matrix-1126).

## Installable Preview Smoke Checklist

See [Installable Preview Smoke Checklist](manual-qa.md#installable-preview-smoke-checklist).

## Web Export Smoke Check

See [Web Export Smoke Check](manual-qa.md#web-export-smoke-check).

### Automated pre-flight (`web:smoke`)

See [Automated pre-flight (`web:smoke`)](manual-qa.md#automated-pre-flight-websmoke).

### Required browser + local-data boot verification (human)

See [Required browser + local-data boot verification (human)](manual-qa.md#required-browser--local-data-boot-verification-human).

### Static hosting note

See [Static hosting note](manual-qa.md#static-hosting-note).

## Android Restore Credentials Migration/Restore Test Flow

See [Android Restore Credentials Migration/Restore Test Flow](manual-qa.md#android-restore-credentials-migrationrestore-test-flow).

## Google Play 2027 Memory and DEX Optimization (#1134)

See [Google Play 2027 Memory and DEX Optimization (#1134)](play-store-readiness.md#google-play-2027-memory-and-dex-optimization-1134).
