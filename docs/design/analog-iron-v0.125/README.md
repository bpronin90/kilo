# Analog Iron & Newsprint v0.125

This directory is the authoritative visual handoff for the Analog Iron &
Newsprint migration. The existing Kilo application remains authoritative for
functionality, behavior, state, navigation, data, and workflows.

## Authority and interpretation

- `visual-language-spec.md` owns the cross-theme visual language, typography,
  copy, geometry, and component rules.
- `dark-mode-implementation-note.md` owns the dark palette and dark surface
  hierarchy. Rules not explicitly changed there inherit from the cross-theme
  specification.
- The PNG files are representative visual states. They do not authorize
  removing or inventing functionality, and unshown states must extend the same
  tokens and component rules.
- Straightforward Kilo terminology is mandatory. Faux-technical copy visible in
  a reference image is not approved product copy. In particular, do not carry
  forward labels such as `SETTINGS LEDGER`, `LEDGER #8402`,
  `TRAINING LEDGER PREFERENCES`, `AUTO DUAL-PASS`, `ACTIVE MOTOR PREP`,
  `TELEMETRY`, `MANIFEST`, or fabricated spec identifiers. Preserve the real
  Kilo concept and use the terminology established in the light-mode handoff.

## Reference exports

| Surface | Light | Dark |
|---|---|---|
| Home | `home-light.png` | `home-dark.png` |
| Log | `log-light.png` | `log-dark.png` |
| Weight | `weight-light.png` | Extend the dark token rules |
| Stats | `stats-light.png` | Extend the dark token rules |
| Settings | `settings-light.png` | `settings-dark.png` |
| Plate Calculator | `plate-calculator-light.png` | Extend the dark token rules |

## Numeric contract

The implementation uses these supplied values:

- Light roles: `background #EAE6DF`, `surface #F4F1EA`,
  `surfaceSubtle #E1DCD3`, `ink #111111`, `inkMuted #66625D`,
  `borderHairline #D5D0C5`, `borderSolid #111111`,
  `accentRed #D92D20`, `successGreen #2E6930`, and
  `cautionAmber #B45309`.
- Dark roles: use the complete `KILO_TOKENS_DARK` contract in
  `dark-mode-implementation-note.md`.
- Type scale: 32/36 display, 16/20 section title, 14/20 data body,
  12/16 caption, and 11/14 micro tag. Space Grotesk is the proportional face;
  tabular data uses the bundled monospace face. No mobile text is below 11px.
- Spacing follows the supplied 4px baseline: 2, 4, 8, 12, 16, 24, 32, and
  48px. Mobile gutter is 12px and mobile outer margin is 16px; desktop gutter
  is 24px and desktop outer margin is 32px.
- Radius is 0px by default and never exceeds 2px.
- Dividers are continuous 1px hairlines. Use `borderHairline` for ordinary
  separation and the solid/high-contrast border roles only for active or
  focused structure.
- Elevation is flat: no shadows, glass, blur, or decorative gradients.
- Vermilion red is reserved for execution and exceptional states, not
  decoration.

