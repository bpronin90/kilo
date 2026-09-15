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
- Known screenshot artifacts are not implementation instructions. The dark
  exports contain stale light-mode red (`#D92D20`) and narrow-width text
  wrapping, clipping, or overlap; implementations must use the dark
  `accentRed` token and responsive row sizing from the written rules instead.
  The clipped chart label in `stats-light.png` is likewise a non-authoritative
  copy/layout artifact; preserve the real product label and render it legibly.
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
  separation. The dark `borderSolid` role is a distinct 1.5px structural frame
  for cards, active containers, and button strokes; use solid/high-contrast
  roles only for active or focused structure.
- Elevation is flat: no shadows, glass, blur, or decorative gradients.
- Vermilion red is reserved for execution and exceptional states, not
  decoration.

## Visual approval package (D0 — #1095)

This section is the decision artifact for D1/D4/D8/D9. It documents chart
treatment alternatives, token tables, contrast evidence, font samples, and
native/hosted control treatment. D1, D4, D8, and D9 may not proceed until
the owner approval checklist at the end of this section is fully checked.

Full decision documentation lives in:
- Chart alternatives, token tables, contrast evidence: §6–8 of `visual-language-spec.md`
- Font evidence and fallback requirements: §9 of `visual-language-spec.md`
- Native/hosted control treatment: §10 of `visual-language-spec.md`
- Dark chart token values: §6 of `dark-mode-implementation-note.md`

Screenshot-only chart types (the blue-gray bar fills visible in `stats-light.png`
and the trend-line shapes in `weight-light.png`), screenshot metrics, ranges, and
data remain unauthorized as implementation specifications. Do not sample the
screenshots or invent values from them.

### Reference exports (direct links)

| Surface | Light | Dark |
|---|---|---|
| Home | [home-light.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/home-light.png) | [home-dark.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/home-dark.png) |
| Log | [log-light.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/log-light.png) | [log-dark.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/log-dark.png) |
| Weight | [weight-light.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/weight-light.png) | Extend dark token rules |
| Stats | [stats-light.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/stats-light.png) | Extend dark token rules |
| Settings | [settings-light.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/settings-light.png) | [settings-dark.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/settings-dark.png) |
| Plate Calculator | [plate-calculator-light.png](https://github.com/bpronin90/kilo/blob/main/docs/design/analog-iron-v0.125/plate-calculator-light.png) | Extend dark token rules |

### Owner approval checklist

- [ ] One chart alternative selected for implementation.
- [ ] Light/dark token tables approved.
- [ ] Actual-pair AA contrast evidence approved.
- [ ] Space Grotesk weights, mono font/license, and fallback behavior approved.
- [ ] Native/hosted control treatment and platform exceptions approved.
- [ ] Existing-reference links and unauthorized screenshot scope reviewed.
- [ ] D1/D4/D8/D9 may proceed against this recorded package.
