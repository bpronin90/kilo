---
name: Kinetic Logic
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#20201f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e5e2e1'
  on-surface-variant: '#cfc4c5'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#988e90'
  outline-variant: '#4c4546'
  surface-tint: '#c6c6c6'
  primary: '#c6c6c6'
  on-primary: '#303030'
  primary-container: '#000000'
  on-primary-container: '#757575'
  inverse-primary: '#5e5e5e'
  secondary: '#ffb59a'
  on-secondary: '#5a1b00'
  secondary-container: '#ff5e07'
  on-secondary-container: '#531900'
  tertiary: '#c6c6c7'
  on-tertiary: '#2f3131'
  tertiary-container: '#000000'
  on-tertiary-container: '#747576'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1b1b1b'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#ffdbce'
  secondary-fixed-dim: '#ffb59a'
  on-secondary-fixed: '#370e00'
  on-secondary-fixed-variant: '#802a00'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353535'
typography:
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 64px
    fontWeight: '700'
    lineHeight: 72px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 64px
  max-width: 1440px
---

## Brand & Style

This design system embodies a **High-Tech Minimalism** aesthetic. It is engineered for precision, performance, and clarity, targeting a sophisticated user base that values efficiency and technical rigor. The visual language is defined by architectural silhouettes, stark contrasts, and purposeful geometric accents.

The emotional response is one of **calculated confidence**. By stripping away decorative clutter and focusing on consistent line weights and sharp junctions, the interface feels like a high-performance tool. The presence of vibrant orange "capsule" accents (inspired by the logo's geometric detailing) provides just enough human energy to ensure the system remains approachable without sacrificing its industrial edge.

## Colors

The palette is rooted in a **True Dark** foundation. 
- **Black (#000000)**: Used for the primary background to create an infinite depth effect, typical of high-end OLED interfaces.
- **Vibrant Orange (#FF5C00)**: Reserved strictly for "Kinetic" elements—actions, progress indicators, and critical data points. It is the lifeblood of the system.
- **White (#FFFFFF)**: Utilized for high-contrast typography and iconography to ensure maximum legibility against the dark void.
- **Surface Neutrals**: A range of deep grays (e.g., #1A1A1A, #2D2D2D) are used to define containers and structural borders without breaking the minimalist harmony.

## Typography

The typography strategy leverages geometric precision and technical clarity.
- **Headlines**: **Space Grotesk** provides the "high-tech" character. Its idiosyncratic terminals and geometric construction mirror the logo's sharp junctions.
- **Body**: **Hanken Grotesk** is used for its superior readability at smaller scales, maintaining a clean, modern sans-serif profile.
- **Data & Labels**: **JetBrains Mono** is introduced for all metadata, technical readouts, and status labels to reinforce the "engineered" nature of the system.

All type is set with high contrast. Headlines should use tight tracking to appear more architectural, while mono-spaced labels use slightly expanded tracking for a "digital display" feel.

## Layout & Spacing

The layout follows a **Rigid 4px Grid System**. Every element, from padding to icon sizing, must be a multiple of 4.
- **Desktop**: A 12-column fixed grid with a maximum width of 1440px. The emphasis is on expansive whitespace to create a "gallery" effect for technical data.
- **Mobile**: A 4-column fluid grid with 16px side margins. 
- **Gutter Logic**: Horizontal gutters remain consistent at 24px, while vertical rhythm is maintained through standardized 32px or 64px section breaks.

Alignment is strictly flush-left. Centered layouts are avoided to maintain the "functional blueprint" aesthetic.

## Elevation & Depth

This design system avoids traditional shadows. Depth is conveyed through **Tonal Layering and Sharp Outlines**.
- **Surface Levels**: Higher elevation is indicated by lighter shades of gray (e.g., #000000 base, #121212 surface, #1E1E1E raised).
- **Outlines**: Components use 1px solid borders in #2D2D2D.
- **Interactive Depth**: When an element is focused or hovered, it does not "lift" with a shadow; instead, it gains a **Vibrant Orange** stroke or a subtle white "glow" (0.5 opacity) to signal engagement.

## Shapes

The primary shape language is **Ultra-Sharp**. 
- **Containers & Buttons**: These must have 0px corner radii. 
- **Geometric Accents**: The "Capsule" shape (found in the logo) is the *only* exception. It is used exclusively for decorative accents, such as the dots on icons, scrollbar thumbs, or progress bar indicators. These capsule accents have a full pill-shaped radius (rounded-xl) to create a striking contrast against the sharp-edged layout.

## Components

### Buttons
Primary buttons are solid Black with a 1px White or Orange border. On hover, the background fills with Vibrant Orange and text flips to Black. No rounded corners.

### Input Fields
Inputs are underlined or outlined with a 1px gray stroke. When active, the stroke becomes Vibrant Orange. All labels use the `label-sm` (JetBrains Mono) typography for a data-entry feel.

### Progress Bars & Indicators
The track is #1A1A1A. The "active" portion is a Vibrant Orange bar with the signature "capsule" rounded ends, creating a visual link to the brand mark.

### Cards
Cards are defined by a 1px border (#2D2D2D) and no background fill (transparent), allowing the black void of the page to show through. Header sections of cards are separated by a 1px horizontal rule.

### Iconography
Icons must use a consistent 1.5px or 2px line weight. They should be strictly geometric. Any "dots" or secondary marks within the icons should use the capsule shape rather than a standard circle.