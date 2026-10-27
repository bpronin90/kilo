import React, { useState, useLayoutEffect, useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { RootHeader } from '../components/RootHeader';
import { useTheme } from '../theme/ThemeContext';
import { MoreMenuPanels } from './more/MoreMenuPanels';
import { Alert } from '../lib/platformAlert';
import { copyTextToClipboard, systemConfirmsClipboardWrite } from '../lib/platformClipboard';

import { HelpScreen } from '../components/HelpScreen';
import { AboutScreen } from '../components/AboutScreen';
import { BackupScreen } from '../components/BackupScreen';
import { SettingsScreen } from '../components/SettingsScreen';
import { ProfileScreen } from '../components/ProfileScreen';
import { RoutineImportScreen } from '../components/RoutineImportScreen';
import { RoutinePromptToolsScreen } from '../components/RoutinePromptToolsScreen';
import { AccountScreen } from './more/AccountScreen';

export { AccountScreen } from './more/AccountScreen';
export { AccountLifecycle } from './more/AccountLifecycle';

// The sub-view vocabulary a typed `{ kind: 'subview', view }` intent may target
// (#718). This screen owns these names, so it — not the app shell — is the one
// place that validates them: App.js's normalizer checks only that `view` is a
// non-empty string, which keeps the shell out of every destination's internal
// view model. 'menu' is deliberately absent: "navigate to the More menu" is
// just an ordinary More tab press, and accepting it as a target would let a
// stray intent yank the user out of a sub-view they are already using.
const NAV_SUBVIEWS = new Set(['help', 'about', 'backup', 'settings', 'profile', 'account', 'import-routine', 'routine-prompts']);

export const FEEDBACK_ADDRESS = 'bpronin90@gmail.com';
export const FEEDBACK_URL = `mailto:${FEEDBACK_ADDRESS}?subject=${encodeURIComponent('Kilo feedback')}`;

async function copyFeedbackAddress(deps) {
  try {
    await deps.copy(FEEDBACK_ADDRESS);
  } catch {
    deps.alert('Could not copy', `Kilo could not copy the address. Send your feedback to ${FEEDBACK_ADDRESS}.`);
    return;
  }
  // Android 13+ already shows its own clipboard popup; skip the in-app one there.
  if (!deps.systemConfirms()) deps.alert('Address copied', `${FEEDBACK_ADDRESS} was copied to the clipboard.`);
}

// Opens a blank-bodied draft in the device email app (#1658). Only the address
// and a fixed subject are prefilled; Kilo never sends mail itself. When no email
// app can be opened the address stays reachable through a copy fallback.
// `deps` follows routineShare.js: the app uses the real platform modules.
export async function sendFeedback(deps = {}) {
  const d = {
    linking: Linking,
    alert: (...args) => Alert.alert(...args),
    copy: copyTextToClipboard,
    systemConfirms: systemConfirmsClipboardWrite,
    platform: Platform.OS,
    ...deps,
  };
  let launched = false;
  try {
    if (await d.linking.canOpenURL(FEEDBACK_URL)) {
      await d.linking.openURL(FEEDBACK_URL);
      launched = true;
    }
  } catch {
    // Fall through to the address fallback below.
  }
  // Web resolves openURL even when no mail handler took the link or the popup
  // was blocked (window.open with `noopener` returns null), so a launch there
  // cannot be confirmed; keep the address reachable instead of going silent.
  if (launched && d.platform !== 'web') return;
  const unconfirmed = launched;
  d.alert(
    unconfirmed ? 'Email not opening?' : 'Email not available',
    unconfirmed
      ? `If your email app did not open, send your feedback to ${FEEDBACK_ADDRESS}.`
      : `Kilo could not open an email app. Send your feedback to ${FEEDBACK_ADDRESS}.`,
    [
      { text: 'Copy address', onPress: () => copyFeedbackAddress(d) },
      { text: 'Dismiss', style: 'cancel' },
    ],
  );
}

export function MoreScreen({
  isActive = true,
  auth,
  registerBackConsumer,
  onOwnsBackChange,
  onExport,
  onImport,
  onCreateRoutineFromImport,
  onReplayWalkthrough,
  fatigueMultiplier,
  onUpdateFatigueMultiplier,
  navSubviewView = null,
  navSubviewAnchor = null,
  navSubviewKey = 0,
}) {
  const { kuaPalette: kua } = useTheme();
  const [activeView, setActiveView] = useState('menu');
  const [routinePromptInitialTool, setRoutinePromptInitialTool] = useState(null);

  // Password recovery (#497): when the shell reports an active recovery
  // session or a failed recovery link, open the Account sub-view so the
  // set-new-password surface (rendered by AccountScreen for these states) is
  // shown. App.js makes the matching switch to the More tab, so together the
  // recovery deep link lands the user directly on the reset surface instead
  // of a dead end. This screen stays mounted across tabs, so the switch is
  // safe even when More is not the visible tab yet. Keyed on the recovery
  // signals so it fires once when recovery begins and does not otherwise
  // override the user's own menu navigation.
  useEffect(() => {
    if (auth?.passwordRecovery || auth?.recoveryError) {
      setActiveView('account');
    }
  }, [auth?.passwordRecovery, auth?.recoveryError]);

  // The anchor of the intent currently being served, republished to the
  // sub-view that owns it (#903). Held as state, not a ref, because the
  // sub-screen has to re-render to see it, and carried together with the view
  // it addressed so an anchor minted for one sub-view can never be applied by
  // another. Cleared by every manual navigation below: a consumed intent must
  // not replay when the user walks back into the same sub-view themselves.
  const [subviewIntent, setSubviewIntent] = useState({ view: null, anchor: null, key: 0 });

  // Typed sub-view navigation intent (#718). Keyed so a repeated request for a
  // sub-view the user has since left still re-applies, and consumed exactly
  // once per key so an unrelated re-render never re-opens it. 0 is the shell's
  // initial key, i.e. "no intent has ever been issued".
  const appliedSubviewKeyRef = useRef(0);
  useEffect(() => {
    if (navSubviewKey === appliedSubviewKeyRef.current) return;
    appliedSubviewKeyRef.current = navSubviewKey;
    // An absent target preserves whatever this screen is already showing, and
    // an unknown view name is ignored the same way rather than dumping the user
    // on the menu.
    if (!navSubviewView || !NAV_SUBVIEWS.has(navSubviewView)) return;
    setActiveView(navSubviewView);
    // Published for anchorless intents too: a `null` anchor under a fresh key
    // is what tells the sub-view this arrival is an ordinary one and must not
    // move the viewport.
    setSubviewIntent({ view: navSubviewView, anchor: navSubviewAnchor || null, key: navSubviewKey });
  }, [navSubviewKey, navSubviewView, navSubviewAnchor]);

  // Every navigation the user makes by hand goes through here, so it also
  // retires whatever intent was last served. Without that, a sub-screen the
  // user re-enters from the menu would remount still holding the shell's old
  // intent key and replay its anchored arrival.
  function showView(view) {
    setSubviewIntent({ view: null, anchor: null, key: 0 });
    setActiveView(view);
  }

  const inSubView = activeView !== 'menu';

  // When this tab is active and showing a sub-view, register a back consumer so
  // the app shell's global back handler returns to the menu (instead of Home) and
  // flag that this screen owns its own back so the web "← Home" bar is suppressed
  // (the sub-screen renders its own "← Back"). Gating on isActive prevents
  // consuming back events meant for another tab while a stale More sub-view stays
  // mounted in the background. Props are optional so the screen renders safely
  // when used standalone (e.g. in tests) without the app shell.
  useLayoutEffect(() => {
    if (!isActive || !inSubView) return undefined;

    onOwnsBackChange?.(true);
    const unregister = registerBackConsumer?.(() => {
      showView('menu');
      return true;
    });

    return () => {
      unregister?.();
      onOwnsBackChange?.(false);
    };
  }, [isActive, inSubView, registerBackConsumer, onOwnsBackChange]);

  if (activeView === 'help') {
    return <HelpScreen onBack={() => showView('menu')} onReplayWalkthrough={() => {
      showView('menu');
      onReplayWalkthrough?.();
    }} />;
  }

  if (activeView === 'about') {
    return <AboutScreen onBack={() => showView('menu')} />;
  }

  if (activeView === 'backup') {
    return (
      <BackupScreen
        onBack={() => showView('menu')}
        onExport={onExport}
        onImport={onImport}
        auth={auth}
        onGoToAccount={() => showView('account')}
        navAnchor={subviewIntent.view === 'backup' ? subviewIntent.anchor : null}
        navAnchorKey={subviewIntent.view === 'backup' ? subviewIntent.key : 0}
      />
    );
  }

  if (activeView === 'import-routine') {
    return (
      <RoutineImportScreen
        onBack={() => showView('menu')}
        onCreateRoutine={onCreateRoutineFromImport}
        onImportNormalization={() => { setRoutinePromptInitialTool('normalize'); showView('routine-prompts'); }}
      />
    );
  }

  if (activeView === 'routine-prompts') {
    return <RoutinePromptToolsScreen onBack={() => showView(routinePromptInitialTool ? 'import-routine' : 'menu')} initialTool={routinePromptInitialTool} />;
  }

  if (activeView === 'settings') {
    return (
      <SettingsScreen
        onBack={() => showView('menu')}
        multiplier={fatigueMultiplier}
        onUpdate={onUpdateFatigueMultiplier}
      />
    );
  }

  if (activeView === 'profile') {
    return <ProfileScreen onBack={() => showView('menu')} />;
  }

  if (activeView === 'account') {
    return <AccountScreen auth={auth} onBack={() => showView('menu')} />;
  }

  return (
    <ScreenShell header={<RootHeader title="More" />} style={kua ? { backgroundColor: kua.background } : undefined}>
      <MoreMenuPanels
        auth={auth}
        onSendFeedback={() => sendFeedback()}
        onOpen={(view) => {
          // The menu's prompt-tools row opens the tool list itself, not the
          // import → normalize handoff, so its back returns to the menu.
          if (view === 'routine-prompts') setRoutinePromptInitialTool(null);
          showView(view);
        }}
      />
    </ScreenShell>
  );
}
