# Color Tokens — All Six Theme/Mode Designs

Each token table is complete and self-contained. All six designs must be implemented. WCAG 2.1 contrast ratios are calculated for the actual foreground/background pairs rendered in the product; values labeled AA meet the 4.5:1 threshold for normal text, and AAA meets 7:1. Large text (≥18px regular or ≥14px bold) requires only 3:1 for AA.

Contrast notation: `fg / bg → ratio (grade)`. Ratios are calculated per the WCAG relative-luminance formula.

---

## Hard Court — Light

Cobalt blue on cool blue-gray canvas. US Open hard-court aesthetic.

### Palette

| Token | Value | Use |
|---|---|---|
| `background` | `#EEF3F9` | App canvas |
| `surface` | `#EEF3F9` | Screen background |
| `surface-card` | `#FFFFFF` | Card background |
| `surface-subtle` | `#EEF3F9` | Section headers within cards |
| `surface-border` | `#DDE6F2` | Dividers, card outlines (inactive) |
| `primary` | `#0A4ABF` | Active states, primary CTA, tab bar active, card border |
| `primary-container` | `#E1ECFB` | Tinted action backgrounds (TRACK untracked state) |
| `primary-container-border` | `#9BC1F5` | Tinted action borders |
| `primary-on-container` | `#083B9A` | Text on primary-container (TRACK button) |
| `surface-card-header` | `#EEF3F9` | Card header section background |
| `surface-section` | `#EEF3F9` | Section header row background within cards |
| `on-surface` | `#0E1726` | Primary body text, headings |
| `on-surface-variant` | `#5A687A` | Secondary text, placeholders, inactive tab labels |
| `completion` | `#006C4A` | Completed/tracked state (green) |
| `on-primary` | `#FFFFFF` | Text on primary-colored surfaces |
| `tab-bar-bg` | `#FFFFFF` | Tab bar background |
| `header-bg` | `#EEF3F9` | Page header background |
| `error` | `#BA1A1A` | Danger button background (shared all themes) |

### WCAG Contrast

| Pair | Ratio | Grade | Used for |
|---|---|---|---|
| `#0E1726` / `#EEF3F9` | 16.1:1 | AAA | Body text on canvas |
| `#0E1726` / `#FFFFFF` | 18.0:1 | AAA | Body text on card |
| `#0A4ABF` / `#EEF3F9` | 6.9:1 | AA | Primary on canvas (tab active, headings) |
| `#0A4ABF` / `#FFFFFF` | 7.7:1 | AAA | Primary on card (card title, borders) |
| `#083B9A` / `#E1ECFB` | 8.4:1 | AAA | TRACK button text on container |
| `#5A687A` / `#EEF3F9` | 5.1:1 | AA | Muted text on canvas |
| `#5A687A` / `#FFFFFF` | 5.7:1 | AA | Muted text on card |
| `#006C4A` / `#FFFFFF` | 6.5:1 | AA | Completion label on card |
| `#FFFFFF` / `#0A4ABF` | 7.7:1 | AAA | White text on primary button |

---

## Hard Court — Dark

Electric blue on deep navy canvas.

### Palette

| Token | Value | Use |
|---|---|---|
| `background` | `#080D18` | App canvas |
| `surface` | `#080D18` | Screen background |
| `surface-card` | `#101728` | Primary card background |
| `surface-card-header` | `#131D32` | Card header section |
| `surface-section` | `#0E1524` | Section divider rows |
| `surface-border` | `#1C2742` | Dividers, inactive borders |
| `primary` | `#3B82F6` | Active states, primary CTA, tab bar active |
| `primary-light` | `#60A5FA` | Lighter primary for icons, chip text |
| `primary-container` | `#17233D` | Tinted action backgrounds (TRACK untracked) |
| `primary-container-border` | `#2A3F6D` | Tinted action borders |
| `on-surface` | `#F0F4FC` | Primary body text |
| `on-surface-variant` | `#8C9BB3` | Secondary text, inactive states |
| `completion` | `#10B981` | Completed/tracked state (green) |
| `on-primary` | `#080D18` | Text on primary-colored surfaces |
| `tab-bar-bg` | `#080D18` | Tab bar background |
| `header-bg` | `#080D18` | Page header background |
| `primary-on-container` | `#60A5FA` | Text on primary-container (TRACK button) |
| `error` | `#BA1A1A` | Danger button background (shared all themes) |

### WCAG Contrast

| Pair | Ratio | Grade | Used for |
|---|---|---|---|
| `#F0F4FC` / `#080D18` | 17.6:1 | AAA | Body text on canvas |
| `#F0F4FC` / `#101728` | 16.2:1 | AAA | Body text on card |
| `#3B82F6` / `#080D18` | 5.3:1 | AA | Primary on canvas (tab active) |
| `#60A5FA` / `#080D18` | 7.6:1 | AAA | Light primary on canvas |
| `#60A5FA` / `#101728` | 7.0:1 | AAA | Light primary on card |
| `#60A5FA` / `#17233D` | 6.1:1 | AA | TRACK button text on container |
| `#8C9BB3` / `#080D18` | 6.9:1 | AA | Muted text on canvas |
| `#8C9BB3` / `#101728` | 6.3:1 | AA | Muted text on card |
| `#080D18` / `#3B82F6` | 5.3:1 | AA | Dark text on primary button |

---

## Clay Court — Light

Terracotta on warm limestone canvas. Roland Garros clay aesthetic.

### Palette

| Token | Value | Use |
|---|---|---|
| `background` | `#F8F5EE` | App canvas (limestone 100) |
| `surface` | `#F8F5EE` | Screen background |
| `surface-card` | `#FFFDF9` | Card background (limestone 50) |
| `surface-elevated` | `#F2EDE4` | Slightly elevated sections (limestone 200) |
| `surface-card-header` | `#F2EDE4` | Card header section background |
| `surface-section` | `#F2EDE4` | Section header row background within cards |
| `surface-border` | `#E5DFD3` | Dividers (limestone 300) |
| `primary` | `#A23E19` | Active states, primary CTA, tab bar active, card border |
| `primary-dark` | `#7E2E0F` | Pressed/hover primary |
| `primary-container` | `#FBECE5` | Tinted action backgrounds |
| `primary-container-border` | `#E89A7A` | Tinted action borders |
| `primary-on-container` | `#7E2E0F` | Text on primary-container (TRACK button) |
| `on-surface` | `#1A1918` | Primary body text (ink) |
| `on-surface-variant` | `#585550` | Secondary text (ink-variant) |
| `on-surface-muted` | `#736D65` | Metadata, placeholder text (limestone-muted) |
| `completion` | `#1E5B3A` | Completed/tracked state (green — distinct from clay primary) |
| `on-primary` | `#FFFFFF` | Text on primary-colored surfaces |
| `tab-bar-bg` | `#F8F5EE` | Tab bar background |
| `header-bg` | `#F8F5EE` | Page header background |
| `error` | `#BA1A1A` | Danger button background (shared all themes) |

### WCAG Contrast

| Pair | Ratio | Grade | Used for |
|---|---|---|---|
| `#1A1918` / `#F8F5EE` | 16.1:1 | AAA | Body text on canvas |
| `#1A1918` / `#FFFDF9` | 17.3:1 | AAA | Body text on card |
| `#A23E19` / `#F8F5EE` | 6.0:1 | AA | Primary on canvas (tab active, card title) |
| `#A23E19` / `#FFFDF9` | 6.4:1 | AA | Primary on card |
| `#585550` / `#F8F5EE` | 6.8:1 | AA | Secondary text on canvas |
| `#585550` / `#FFFDF9` | 7.3:1 | AAA | Secondary text on card |
| `#736D65` / `#F8F5EE` | 4.7:1 | AA | Muted text on canvas |
| `#736D65` / `#FFFDF9` | 5.0:1 | AA | Muted text on card |
| `#1E5B3A` / `#FFFDF9` | 7.9:1 | AAA | Completion label on card |
| `#7E2E0F` / `#FBECE5` | 8.0:1 | AAA | TRACK button text on container |
| `#FFFFFF` / `#A23E19` | 6.5:1 | AA | White text on primary button |

---

## Clay Court — Dark

Clay orange on deep earthen canvas.

### Palette

| Token | Value | Use |
|---|---|---|
| `background` | `#141211` | App canvas |
| `surface` | `#141211` | Screen background |
| `surface-card` | `#1F1C1A` | Primary card background (surface-variant) |
| `surface-card-header` | `#181513` | Card header section |
| `surface-low` | `#1A1816` | Segmented control background (surface-container-low) |
| `surface-border` | `#2C2723` | Dividers (outline-variant) |
| `primary` | `#D86538` | Active states, primary CTA, tab bar active, card border |
| `primary-light` | `#F08B62` | Lighter primary for icon accents |
| `primary-container` | `#341B13` | Tinted action backgrounds (TRACK untracked) |
| `primary-container-border` | `#5C2E1E` | Tinted action borders |
| `primary-on-container` | `#F08B62` | Text on primary-container (TRACK button) |
| `surface-section` | `#1A1816` | Section header row background within cards |
| `on-surface` | `#F5F3F0` | Primary body text |
| `on-surface-variant` | `#A89F96` | Secondary text, inactive states |
| `completion` | `#2CA864` | Completed/tracked state (green) |
| `on-primary` | `#141211` | Text on primary-colored surfaces |
| `tab-bar-bg` | `#141211` | Tab bar background |
| `header-bg` | `#141211` | Page header background |
| `error` | `#BA1A1A` | Danger button background (shared all themes) |

### WCAG Contrast

| Pair | Ratio | Grade | Used for |
|---|---|---|---|
| `#F5F3F0` / `#141211` | 16.9:1 | AAA | Body text on canvas |
| `#F5F3F0` / `#1F1C1A` | 15.3:1 | AAA | Body text on card |
| `#D86538` / `#141211` | 5.2:1 | AA | Primary on canvas (tab active) |
| `#F08B62` / `#341B13` | 6.5:1 | AA | TRACK button text on container |
| `#A89F96` / `#141211` | 7.2:1 | AAA | Muted text on canvas |
| `#A89F96` / `#1F1C1A` | 6.5:1 | AA | Muted text on card |
| `#141211` / `#D86538` | 5.2:1 | AA | Dark text on primary button |
| `#2CA864` / `#141211` | 6.1:1 | AA | Completion state on canvas |

---

## Grass Court — Light

Court green on pale green canvas. Wimbledon grass aesthetic.

### Palette

| Token | Value | Use |
|---|---|---|
| `background` | `#F4F8F5` | App canvas (lawn-bg) |
| `surface` | `#F4F8F5` | Screen background |
| `surface-card` | `#FFFFFF` | Card background |
| `surface-subtle` | `#F2F7F4` | Section headers within cards (surface-subtle) |
| `surface-card-header` | `#F4F8F5` | Card header section background |
| `surface-section` | `#F2F7F4` | Section header row background within cards |
| `surface-border` | `#E0EAE3` | Dividers, inactive card borders |
| `surface-seg` | `#E8EFEA` | Segmented control background |
| `surface-seg-border` | `#DEE7E1` | Segmented control border |
| `primary` | `#1E5B3A` | Active states, primary CTA, tab bar active, card border (lawn-green) |
| `primary-dark` | `#14452B` | Pressed/hover primary (lawn-dark) |
| `primary-container` | `#E8F4EC` | Tinted action backgrounds (lawn-light) |
| `primary-container-border` | `#A3D4B3` | Tinted action borders (lawn-border) |
| `primary-on-container` | `#14452B` | Text on primary-container |
| `on-surface` | `#111813` | Primary body text (ink) |
| `on-surface-variant` | `#556B5C` | Secondary text (ink-muted) |
| `completion` | `#1E5B3A` | Completed/tracked state (same as primary — green is semantic here) |
| `on-primary` | `#FFFFFF` | Text on primary-colored surfaces |
| `tab-bar-bg` | `#F4F8F5` | Tab bar background |
| `header-bg` | `#F4F8F5` | Page header background |
| `error` | `#BA1A1A` | Danger button background (shared all themes) |

### WCAG Contrast

| Pair | Ratio | Grade | Used for |
|---|---|---|---|
| `#111813` / `#F4F8F5` | 16.8:1 | AAA | Body text on canvas |
| `#111813` / `#FFFFFF` | 18.0:1 | AAA | Body text on card |
| `#1E5B3A` / `#F4F8F5` | 7.5:1 | AAA | Primary on canvas (tab active, card title) |
| `#1E5B3A` / `#FFFFFF` | 8.0:1 | AAA | Primary on card (card border, heading) |
| `#14452B` / `#E8F4EC` | 9.7:1 | AAA | TRACK button text on container |
| `#556B5C` / `#F4F8F5` | 5.4:1 | AA | Muted text on canvas |
| `#556B5C` / `#FFFFFF` | 5.8:1 | AA | Muted text on card |
| `#FFFFFF` / `#1E5B3A` | 8.0:1 | AAA | White text on primary button |

---

## Grass Court — Dark

Athletic green on deep forest canvas.

### Palette

| Token | Value | Use |
|---|---|---|
| `background` | `#0C130F` | App canvas (tournament-bg) |
| `surface` | `#0C130F` | Screen background |
| `surface-card` | `#15201A` | Primary card background (court-card) |
| `surface-card-header` | `#0C130F` | Card header section background |
| `surface-low` | `#111A15` | Segmented control background (dark-pine) |
| `surface-section` | `#111A15` | Section header row background within cards |
| `surface-border` | `#1F3025` | Dividers (dark-border) |
| `surface-surface-2` | `#1C2B22` | Subtle elevated surfaces |
| `primary` | `#2CA864` | Active states, primary CTA, tab bar active, card border (court-green) |
| `primary-neon` | `#4ADE80` | Status dots, pulsing indicators (court-neon) |
| `primary-container` | `#132B1C` | Tinted action backgrounds (pine-tag) |
| `primary-container-border` | `#235235` | Tinted action borders |
| `primary-on-container` | `#4ADE80` | Text on primary-container (TRACK button) |
| `on-surface` | `#F0F5F2` | Primary body text (chalk-white) |
| `on-surface-variant` | `#91A398` | Secondary text (sage-muted) |
| `completion` | `#2CA864` | Completed/tracked state (same primary; green is the semantic here) |
| `on-primary` | `#0C130F` | Text on primary-colored surfaces |
| `tab-bar-bg` | `#0C130F` | Tab bar background |
| `header-bg` | `#0C130F` | Page header background |
| `error` | `#BA1A1A` | Danger button background (shared all themes) |

### WCAG Contrast

| Pair | Ratio | Grade | Used for |
|---|---|---|---|
| `#F0F5F2` / `#0C130F` | 17.1:1 | AAA | Body text on canvas |
| `#F0F5F2` / `#15201A` | 15.2:1 | AAA | Body text on card |
| `#2CA864` / `#0C130F` | 6.2:1 | AA | Primary on canvas (tab active) |
| `#2CA864` / `#15201A` | 5.5:1 | AA | Primary on card (card border, accent) |
| `#4ADE80` / `#132B1C` | 8.7:1 | AAA | TRACK button text on container |
| `#91A398` / `#0C130F` | 7.1:1 | AAA | Muted text on canvas |
| `#91A398` / `#15201A` | 6.3:1 | AA | Muted text on card |
| `#0C130F` / `#2CA864` | 6.2:1 | AA | Dark text on primary button |

---

## Shared semantic tokens

The following tokens carry fixed meaning across all three themes and must not vary by theme. D1 exports these values identically in every palette.

### Shared — Light mode

| Token | Value | Semantic use |
|---|---|---|
| `success` | `#006C4A` | Completed / confirmed state (same green family as completion) |
| `warning` | `#B45309` | Caution requiring attention; amber-700 (5.0:1 on white ✓ AA) |
| `chart-series-1` | `#0694A2` | First chart series — teal (graphic element, not text) |
| `chart-series-2` | `#D97706` | Second chart series — amber (graphic element) |
| `chart-series-3` | `#7C3AED` | Third chart series — violet (5.7:1 on white ✓ AA) |

### Shared — Dark mode

| Token | Value | Semantic use |
|---|---|---|
| `success` | `#10B981` | Completed / confirmed state |
| `warning` | `#FBBF24` | Caution state; amber-300 (≥11:1 on all dark canvases ✓ AAA) |
| `chart-series-1` | `#22D3EE` | First chart series — teal (10.8:1 on dark canvas ✓ AAA) |
| `chart-series-2` | `#F59E0B` | Second chart series — amber (9.4:1 on dark canvas ✓ AAA) |
| `chart-series-3` | `#A78BFA` | Third chart series — violet (7.1:1 on dark canvas ✓ AAA) |

### Selection

`selection` maps to each theme's `primary-container` token. The selection highlight tint is the same surface used for tinted action backgrounds, keeping the selected state visually consistent with the theme.

| Theme | Light `selection` | Dark `selection` |
|---|---|---|
| Hard Court | `#E1ECFB` | `#17233D` |
| Clay Court | `#FBECE5` | `#341B13` |
| Grass Court | `#E8F4EC` | `#132B1C` |

---

## Semantic role contract

The following roles carry fixed meaning across all three themes. Theme colors must not alter these meanings.

| Role | Semantic meaning | Must not be used for |
|---|---|---|
| `completion` | A set, exercise, or task is fully logged | Status that is uncertain or partial |
| `error` | A destructive or failed state | Warnings or informational states |
| `warning` | A caution requiring attention but not failure | Completed states |
| `selection` | The currently active/focused item | Completed states |
| `chart-series-N` | A specific data series in a chart | Other chart series of the same index |

Chart data series use theme-neutral colors (e.g., teal, amber, violet) chosen independently per chart; they are not the theme primary color. Meaning across series is carried by labels, not color alone.
