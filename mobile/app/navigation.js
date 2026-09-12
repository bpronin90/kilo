// Pure shell helpers extracted from App.js (#1047): the typed cross-screen
// navigation vocabulary and the fire-and-forget product-measurement emit.
//
// These are deliberately free of React hooks and of the shell's rendering, so
// they can be unit-tested directly and imported by the hook-owning shell
// composition (app/AppShell.js) without a circular dependency. App.js
// re-exports the public members (emitMeasurement, analyticsSectionVariant,
// CLOUD_SYNC_NAV_TARGET, normalizeNavTarget) so the module's export surface is
// unchanged.

import { recordProductMeasurement } from '../lib/productMeasurement';

// Fire-and-forget product measurement emit (#672). recordProductMeasurement
// already no-ops when consent is off and routes every event through the
// allow-list sanitizer, so call sites stay non-blocking and never surface
// instrumentation failures into the user-facing save/navigation flow.
export function emitMeasurement(name, properties = {}) {
  Promise.resolve()
    .then(() => recordProductMeasurement(name, properties))
    .catch(() => {});
}

// Map the free-form Analytics navigation section to the sanitizer's bounded
// analytics_viewed variant list. Home and Weight both pass a section today
// (#717): the weight-trend handoffs request 'weight', the 1K Progress header
// requests 'strength', Exercise Progress requests 'progressive-overload',
// Recovery requests 'recovery', and `Full history and insights` requests
// 'overview' (#770). A plain tab press passes none and also resolves to
// 'overview' — it lands on whatever Analytics was already showing, which for a
// first visit is the top of the tab.
//
// The variant list is `overview | strength | weight | other` and lives in the
// sanitizer, which this issue does not touch. 'progressive-overload' is the
// per-lift strength progression table, so it reports as 'strength' and keeps
// the Exercise Progress signal continuous across the retarget. 'recovery' has
// no variant of its own and is honestly reported as 'other' rather than
// borrowed onto a section it is not.
export function analyticsSectionVariant(section) {
  if (section === 'strength' || section === 'weight') return section;
  if (section === 'progressive-overload') return 'strength';
  if (section === 'overview' || section == null) return 'overview';
  return 'other';
}

// The bounded Analytics destination vocabulary (#717, extended in #770). Every
// id here is a place AnalyticsScreen knows how to land on; anything else is
// rejected by normalizeNavTarget below and ignored.
const ANALYTICS_SECTION_IDS = new Set([
  'overview',
  'weight',
  'strength',
  'progressive-overload',
  'recovery',
]);

// The single typed intent that reaches Cloud Sync (#737). Cloud Sync is a panel
// inside More > Data & Backup (moved there from Account by #822 — Account is
// now identity-only), so the destination sub-view is `backup` and the panel
// itself is the anchor. Built through the ordinary `{ tab, target }` contract
// (#718) rather than a bespoke route: the shell mints the monotonic key, so
// asking for Cloud Sync twice in a row still re-applies both times.
export const CLOUD_SYNC_NAV_TARGET = { kind: 'subview', view: 'backup', anchor: 'cloud-sync' };

// Typed cross-screen navigation intents (#718). A navigation request is
// `{ tab, target, key }`: `handleTabPress(tab, target)` carries the first two
// and the shell mints the monotonic `key` itself, so an identical intent stays
// re-consumable. The target vocabulary is:
//
//   { kind: 'section', id: <ANALYTICS_SECTION_IDS> } → Analytics
//   { kind: 'note',    noteId: string }              → Log
//   { kind: 'recovery-note', noteId?: string }       → Log, Recovery view
//   { kind: 'subview', view: string, anchor?: string } → More
//
// This normalizer is the single place that decides whether a request is a
// legitimate intent for the destination tab. It validates SHAPE and tab/kind
// pairing only — never a destination's internal vocabulary. `subview` view
// names belong to MoreScreen, so the shell deliberately accepts any non-empty
// string and leaves the whitelist to the one screen that owns those views.
// Anything malformed, unknown, or addressed to the wrong tab normalizes to
// null and is safely ignored rather than throwing or half-applying.
//
// A bare string is still accepted for Analytics: HomeScreen and WeightScreen
// call `onNavigate('Analytics', 'weight' | 'strength')` (#717) and are not part
// of this change, so the legacy form is normalized into the typed section
// target instead of being rewritten at every call site.
//
// Exported for direct unit testing, like analyticsSectionVariant above.
export function normalizeNavTarget(tab, targetInput) {
  if (targetInput == null) return null;
  const target = typeof targetInput === 'string'
    ? { kind: 'section', id: targetInput }
    : targetInput;
  if (typeof target !== 'object') return null;
  if (target.kind === 'section' && tab === 'Analytics' && ANALYTICS_SECTION_IDS.has(target.id)) {
    return { kind: 'section', id: target.id };
  }
  if (target.kind === 'note' && tab === 'Log' && typeof target.noteId === 'string' && target.noteId) {
    return { kind: 'note', noteId: target.noteId };
  }
  // Recovery view intent (#869): lands Log on its Recovery view rather than
  // treating the note as an ordinary Routine/Deload note (the plain `note`
  // kind above forces Routine/Deload and opens the wrong viewer for a
  // recovery-linked note — #874 review). `noteId` is optional: absent, it
  // is "just land on Recovery" (the between-weeks decision, or an active
  // week whose linked note could not be resolved); present, Log also
  // focuses that specific recovery note.
  if (target.kind === 'recovery-note' && tab === 'Log') {
    return {
      kind: 'recovery-note',
      noteId: typeof target.noteId === 'string' && target.noteId ? target.noteId : null,
    };
  }
  if (target.kind === 'subview' && tab === 'More' && typeof target.view === 'string' && target.view) {
    return {
      kind: 'subview',
      view: target.view,
      anchor: typeof target.anchor === 'string' && target.anchor ? target.anchor : null,
    };
  }
  return null;
}
