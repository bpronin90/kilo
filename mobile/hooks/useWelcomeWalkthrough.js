import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard } from 'react-native';
import { readWelcomeWalkthrough, dismissWelcomeWalkthrough } from '../storage/welcomeWalkthrough';

export const WALKTHROUGH_STEPS = [
  { tab: 'Home', body: 'Your training and body weight at a glance. Your dashboard fills in as you log.' },
  { tab: 'Log', body: 'Write or import a routine, then record your workouts. The editor includes an example to help you start.' },
  { tab: 'Weight', body: 'Record weigh-ins and set a goal to follow your weight trend.' },
  { tab: 'Analytics', body: 'Review your training and weight trends as your history grows.' },
  { tab: 'More', body: 'Find settings, backup options, and Help here. You can replay this tour from Help.' },
];

export function useWelcomeWalkthrough({ ready, firstUse, blocked, activeTab, navigate }) {
  const [preference, setPreference] = useState('loading');
  const [step, setStep] = useState(null);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible?.() === true);
  const [anchor, setAnchor] = useState(null);
  const [request, setRequest] = useState(0);
  const [dismissalRequest, setDismissalRequest] = useState(0);
  const sessionSuppressed = useRef(false);
  const current = useRef(null);
  const alive = useRef(true);
  const latest = useRef();
  latest.current = { ready, blocked: blocked || keyboardVisible, activeTab, navigate, request };

  useEffect(() => {
    alive.current = true;
    let live = true;
    readWelcomeWalkthrough().then((value) => { if (live) setPreference(value); });
    return () => { live = false; alive.current = false; };
  }, []);

  // Keyboard listeners are session-scoped; no keyboard dismissal or draft writes.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const interrupt = useCallback(() => {
    sessionSuppressed.current = true;
    current.current = null;
    setStep(null);
    setAnchor(null);
  }, []);

  const move = useCallback((index) => {
    current.current = index;
    setAnchor(null);
    setStep(index);
    setRequest((value) => value + 1);
    latest.current.navigate(WALKTHROUGH_STEPS[index].tab);
  }, []);

  const replay = useCallback(() => {
    if (!latest.current.ready || latest.current.blocked || Keyboard.isVisible?.()) return;
    sessionSuppressed.current = true;
    move(0);
  }, [move]);

  const dismiss = useCallback((done = false) => {
    if (current.current === null) return;
    interrupt(); // Memory suppression precedes the fallible disk write.
    setPreference('dismissed');
    setDismissalRequest((value) => value + 1);
    void dismissWelcomeWalkthrough();
    if (done) latest.current.navigate('Home');
  }, [interrupt]);

  useEffect(() => {
    if (!ready || blocked || keyboardVisible) {
      if (current.current !== null) interrupt();
      return;
    }
    if (preference === 'missing' && firstUse === 'empty' && activeTab === 'Home'
        && !sessionSuppressed.current && current.current === null) {
      sessionSuppressed.current = true;
      move(0);
    }
  }, [ready, blocked, keyboardVisible, preference, firstUse, activeTab, interrupt, move]);

  // External navigation (e.g. recovery deep link) wins without being undone.
  useEffect(() => {
    if (step !== null && activeTab !== WALKTHROUGH_STEPS[step].tab) interrupt();
  }, [activeTab, step, interrupt]);

  useEffect(() => {
    if (step === null) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { dismiss(); return true; });
    return () => sub.remove();
  }, [step, dismiss]);

  const measureAnchor = useCallback((measurement) => {
    if (!alive.current || current.current === null) return;
    // Measurements may arrive out of order after rotation or rapid navigation.
    if (measurement?.request !== latest.current.request || measurement.tab !== WALKTHROUGH_STEPS[current.current].tab) return;
    setAnchor(measurement);
  }, []);

  const advance = useCallback((direction, renderedStep) => {
    // Each rendered action may be consumed once; a repeated tap on an old
    // button cannot advance a second screen before React commits the new tip.
    if (current.current !== renderedStep || !anchor || latest.current.blocked) return;
    const index = renderedStep + direction;
    if (index >= 0 && index < WALKTHROUGH_STEPS.length) move(index);
  }, [anchor, move]);

  const active = step !== null && ready && !blocked && !keyboardVisible
    && activeTab === WALKTHROUGH_STEPS[step].tab;
  return { active, step, dismissalRequest, anchor: active ? anchor : null, request,
    measureAnchor, replay, skip: dismiss, done: () => dismiss(true),
    next: () => advance(1, step), back: () => advance(-1, step) };
}
