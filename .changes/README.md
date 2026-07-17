# Changelog fragments

Product pull requests that need release notes add a file named
`<issue>-<sequence>.md`, for example `600-1.md`:

```text
issue: 600
bump: patch

Fixed the user-visible behavior.
```

Use `patch` for fixes and small updates or `minor` for a new user-visible
capability or meaningful behavior change. Follow-up pull requests for the same
issue increment the sequence. Release preparation consumes only the fragments
present when it starts; fragments merged later remain for the next release.
