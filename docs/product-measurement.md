# Product Measurement Privacy Contract

Kilo product measurement exists to test whether the note-first workflow is fast, understandable, and useful. It is not health-data analytics.

## Consent

- Disabled by default.
- Separate from account creation, cloud sync, crash reporting, and health-data consent.
- Revocation clears the local measurement buffer immediately.

## Data that may be recorded

Only allow-listed event names and bounded fields:

- tab name from the five fixed Kilo tabs
- success/failure booleans
- bounded elapsed time
- bounded parser-warning counts
- fixed Analytics section variants

## Data that must never be recorded

- workout or note text
- exercise names
- weights, repetitions, sets, dates, goals, or profile fields
- account IDs, email addresses, device advertising IDs, or contact information
- arbitrary strings or unreviewed metadata

The client sanitizer discards unknown event names, unknown fields, and values outside their documented bounds.

## Storage and transport

The initial implementation stores a maximum of 500 sanitized events locally in AsyncStorage. It does not send events anywhere. A later transport change must preserve this contract, add explicit deletion behavior, and receive a separate privacy/security review before activation.

## Intended questions

The event vocabulary is designed to support aggregate answers such as:

- How long does a workout or weight save take?
- How often does parsing surface warnings?
- Which main surfaces are used after logging?
- Do save attempts succeed?

It cannot reconstruct what a user lifted, weighed, wrote, or viewed within their private data.
