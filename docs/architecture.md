# Architecture

Kilo is transitioning from a client-only React prototype into a modern React
Native application.

The **native app surface** (located in `mobile/`) uses React Native and Expo.
It follows a standard modular component architecture with centralized state and
design tokens.

The **legacy prototype surface** (located at the repo root) runs in the browser
using CDN React and Babel transpilation, and includes a minimal Android
Capacitor shell that stages that same web app into a WebView.

## Native App Architecture (mobile/)

The native app is the primary target for the Kilo MVP. It is built with React
Native and Expo, providing a native UI shell that replaces the web-prototype
WebView loop.

### Core Structure
- **Root (`App.js`)**: Manages the top-level navigation state (tabs) and the
  shared application state (logging entries).
- **Screens (`screens/`)**: Individual app screens (Home, Log, Weight, Stats).
- **Components (`components/`)**: Reusable UI primitives (ScreenShell, Card,
  Button, etc.).
- **Theme (`theme/`)**: Centralized design tokens (Colors).
- **Lib (`lib/`)**: Shared utility functions (formatters).

### Navigation
Navigation is implemented using in-memory state in `App.js` and a custom
`TabBar` component. It does not use `react-navigation` to keep the initial MVP
port lean and dependency-free.

### State and Persistence
The native app currently uses React `useState` for in-memory persistence of
logged entries during a session. Migration of the parser and `localStorage`
persistence logic from the web prototype is a follow-up task.

## Legacy Prototype Architecture (src/)

`Kilo.html` is the legacy entry point. It loads React, ReactDOM, and Babel from
CDN, then loads source files as `<script type="text/babel">` tags.

### Runtime Shape (Legacy)
