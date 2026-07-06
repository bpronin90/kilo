# Tester Guide

This guide is for external testers installing and exercising Kilo preview
builds on a physical Android phone. It only covers what testers need: install,
update, accounts/data behavior, what to check, and how to report issues.

## What Kilo is

Kilo is a local-first fitness-tracking app built with Expo/React Native. Your
workout notes, weight entries, and history stay on your device by default.
Some preview builds are configured with cloud (Supabase) sign-in, which adds
optional account sync on top of the same local-first behavior; if you never
sign in, everything still stays local-only.

## Installing Kilo on Android

There are two install paths depending on which testing phase you are in.

### Play Store closed-testing track (current path for production readiness)

If you received a Play Store opt-in link, you are participating in the
Google Play closed testing track. This is the production-track testing
path required before the app can be publicly released.

1. Open the opt-in link on your Android phone. It will take you to a
   Play Store page where you can join the testing program.
2. Tap **Become a tester**, then tap the app download link that appears
   to install from the Play Store normally.
3. Once installed, updates will arrive through the Play Store like any
   production app.

You do not need to allow "unknown sources" for this path — the app
installs through the standard Play Store flow.

Important: stay opted in to the Play Store testing program for at least
14 continuous days. If you leave and rejoin, Google may reset your testing
window. During that period, open Kilo a few times, work through the checklist
below, and send feedback even if everything works.

Feedback can be brief:

- What device you used.
- Whether install, launch, logging, analytics, and relaunch worked.
- Anything confusing, broken, slow, or visually off.
- "No issues found" if the pass was clean.

### EAS APK direct install (pre-Play-track method)

Testers in earlier preview phases received an APK via an EAS build link
(not the Play Store). If you were given an APK link rather than a Play
Store opt-in link, use this path:

1. Open the link on your Android phone and download the APK.
2. If prompted, allow installs from your browser or "unknown sources" —
   this is expected for a preview build shared outside the Play Store.
3. Install and open the app from your launcher.

iOS preview delivery is not yet verified end to end and is deferred (issue
#63). For now, preview builds are Android only.

## Updates

**EAS APK path:** Builds receive over-the-air (OTA) JavaScript and asset
updates automatically when you launch the app, over the `preview` update
channel. Most updates apply this way — you do not need to reinstall anything,
and the app will just reflect the latest changes the next time you open it.
You'll only need to install a new APK when you're told a build includes
native-level changes that OTA updates can't carry.

**Play Store closed-testing path:** Updates are delivered through the Play
Store. You will receive update notifications the same way you would for any
production app.

## Accounts and data

Kilo works fully offline with no account at all — you can use every feature
without signing in, and your data stays local to your device.

Some builds are configured with cloud sign-in for optional sync. If you're
not given specific sign-in instructions with your build, assume the account
features aren't available or aren't the focus of your test — use the app
signed out. Open public signup is still gated pending CAPTCHA and production
email delivery, so use whatever account instructions accompany your build
rather than trying to self-register.

If you do sign in and later delete your account, your local history on the
device is preserved — deletion only removes the server-side account, not
your on-device data.

## What to exercise

Work through these on your device:

1. Install and launch the app. Confirm it opens without crashing or showing
   a blank screen.
2. Confirm all five tabs are visible and respond to taps: **Home**, **Log**,
   **Weight**, **Analytics**, **More**.
3. On **Log**, enter a simple workout note (for example `135 5,5,5`).
   Confirm a parse preview appears, the Save action becomes enabled, and
   saving shows a confirmation.
4. On **Weight**, log a weight entry (for example `185`). Confirm the Log
   button is disabled when the field is empty and enabled once you enter a
   value, and that the entry appears in your Entries list after saving.
5. Check that **Analytics** renders without errors after you have at least
   one workout and one weight entry logged.
6. Go back to **Home** and confirm your new workout appears in Recent
   history, most recent first.
7. Fully close and relaunch the app. Confirm your workout and weight entries
   are still there.
8. From **More**, try the backup/export action under Data & Backup. You
   should see a confirmation that the export is unencrypted before it
   shares.
9. Do a general touch pass: scroll history lists, switch between tabs a few
   times, and confirm taps register cleanly with no missed or stuck
   interactions.

## Reporting issues

When something looks wrong, include:

- The app version shown in the header (`vX.Y.Z`).
- Your device model and Android version.
- Steps to reproduce.
- What you expected to see vs. what actually happened.

File issues through GitHub Issues on `bpronin90/kilo`, or whatever channel
you were given the build through.
