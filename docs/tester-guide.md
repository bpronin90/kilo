# Play Store Beta Tester Guide

This guide is for beta testers installing and exercising Kilo through the
Google Play closed-testing track on a physical Android phone. It only covers
what testers need for the Play beta: join the test, install, stay opted in,
exercise the app, and report what happened.

## What Kilo is

Kilo is a local-first fitness-tracking app built with Expo/React Native. Your
workout notes, weight entries, and history stay on your device by default.
Some beta builds are configured with cloud (Supabase) sign-in, which adds
optional account sync on top of the same local-first behavior; if you never
sign in, everything still stays local-only.

## Join The Play Beta

Use this path if you received a Google Play testing opt-in link. This is the
current production-readiness path.

1. Open the opt-in link on your Android phone.
2. Tap **Become a tester**.
3. Tap the app download link that appears after you join.
4. Install Kilo from the Play Store normally.
5. Open Kilo from your phone launcher.

You do not need to allow "unknown sources" for this path — the app
installs through the standard Play Store flow.

## 14-Day Beta Requirement

Stay opted in to the Play Store testing program for at least 14 continuous
days. If you leave and rejoin, Google may reset your testing window.

During the 14 days:

- Keep the beta installed.
- Open Kilo a few times instead of only installing it once.
- Work through the checklist below.
- Send feedback even if everything works.

Feedback can be brief:

- What device you used.
- Whether install, launch, logging, analytics, and relaunch worked.
- Anything confusing, broken, slow, or visually off.
- "No issues found" if the pass was clean.

## Updates

For Play beta testers, updates are delivered through the Play Store. You will
receive update notifications the same way you would for any production app.

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

## Legacy EAS APK Preview Path

Earlier preview phases used direct APK installs from EAS instead of the Play
Store. That path is not the current beta testing path.

If you are specifically given an EAS APK link instead of a Play Store opt-in
link:

1. Open the link on your Android phone and download the APK.
2. If prompted, allow installs from your browser or "unknown sources".
3. Install and open the app from your launcher.

EAS APK builds receive over-the-air JavaScript and asset updates through the
`preview` update channel. Play beta builds update through the Play Store.

iOS preview delivery is not yet verified end to end and is deferred (issue
#63). For now, beta testing is Android only.
