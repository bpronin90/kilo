import { useEffect, useRef, useState } from 'react';

// The one section id that needs no measurement: "the top of Analytics" (#770).
// The Overview card is gone (Home owns the summary); the legacy id still means
// offset 0. A plain Analytics tab press preserves the last position instead.
export const OVERVIEW_SECTION = 'overview';

// Deep-link aliases resolved before navigation (#1602). `bodyweight` is the
// redesigned chapter's name for the weight section; it lands on the same anchor.
export const SECTION_ALIASES = { bodyweight: 'weight' };

// Sections that live inside the collapsed baseline disclosure while Recovery is
// active (#871). They must open it first, and once open they report offsets
// relative to the paused body rather than to the scroll content.
const BASELINE_SECTIONS = new Set(['strength', 'progressive-overload']);

// A chapter counts as "current" once its header is within this many px of the
// top of the scroll viewport; a programmatic chapter jump holds the index for
// SPY_LOCK_MS so the animation's intermediate positions cannot flicker it.
const SPY_THRESHOLD = 24;
const SPY_LOCK_MS = 700;

export function resolveSectionId(section) {
  return SECTION_ALIASES[section] || section;
}

// Analytics scroll navigation (#770, #871, #1602): deep-link section requests
// (prop handoff with a nonce), the chapter index (tap-to-scroll) and the
// scroll-spy that keeps the index in step with the reader. One measurement map
// serves all three; nothing is guessed before its layout is known.
export function useAnalyticsChapterNavigation({
  section,
  sectionNonce,
  isActiveRecovery,
  baselineCollapsed,
  setBaselineCollapsed,
  chapters,
  reduceMotion,
}) {
  const scrollRef = useRef(null);
  // Measured top of every targetable section, keyed by the shell's bounded
  // section id (#770). An id missing from this map means "not laid out yet" —
  // the request stays pending, fulfilled by whichever layout resolves it.
  const sectionOffsets = useRef({});
  // Offsets of baseline sections relative to the paused body, and the body's
  // own offset, while they are nested inside it (#1602).
  const nestedOffsets = useRef({});
  const pausedBodyOffset = useRef(null);
  const chapterOffsets = useRef({});
  const pendingSection = useRef(resolveSectionId(section));
  const hasScrolled = useRef(false);
  const spyLockUntil = useRef(0);
  const [spiedChapter, setSpiedChapter] = useState(null);
  const nested = (id) => isActiveRecovery && BASELINE_SECTIONS.has(id);

  function resolveOffset(id) {
    if (!nested(id)) return sectionOffsets.current[id];
    const rel = nestedOffsets.current[id];
    return pausedBodyOffset.current != null && rel != null ? pausedBodyOffset.current + rel : undefined;
  }

  function scrollToOffset(y) {
    scrollRef.current?.scrollTo({ y, animated: !reduceMotion });
    hasScrolled.current = true;
  }

  function fulfillPending() {
    const id = pendingSection.current;
    if (!id || hasScrolled.current) return;
    const y = resolveOffset(id);
    if (y != null) scrollToOffset(y);
  }

  // One navigation path for every section request (prop handoff or same-screen
  // tap, #871). A destination inside the collapsed baseline disclosure expands
  // it first and lets the layout that follows fulfill the pending request,
  // rather than reading offsets while unmounted.
  function navigateToSection(rawId) {
    const sectionId = resolveSectionId(rawId);
    pendingSection.current = sectionId;
    hasScrolled.current = false;

    // The overview is the top of the tab — its position is known without
    // measurement. Every other destination waits for its own layout.
    if (sectionId === OVERVIEW_SECTION) {
      scrollToOffset(0);
      return;
    }
    if (isActiveRecovery && baselineCollapsed && BASELINE_SECTIONS.has(sectionId)) {
      // The paused body is unmounted while collapsed. Its previous body and
      // child coordinates describe the old layout, so wait for both fresh
      // onLayout measurements after opening instead of scrolling to stale data.
      pausedBodyOffset.current = null;
      nestedOffsets.current = {};
      setBaselineCollapsed(false);
      return;
    }
    const y = resolveOffset(sectionId);
    if (y > 0) scrollToOffset(y);
  }

  useEffect(() => {
    if (!section) {
      pendingSection.current = section;
      hasScrolled.current = false;
      return;
    }
    navigateToSection(section);
    // `sectionNonce` changes on every navigation request, so repeating the same
    // handoff (weight → weight) re-targets the section instead of no-op'ing.
  }, [section, sectionNonce, isActiveRecovery, baselineCollapsed]);

  // One measurement path for every section (#770); `hasScrolled` keeps a later
  // reflow from yanking the user back after they land.
  function recordSectionOffset(id, y) {
    const map = nested(id) ? nestedOffsets.current : sectionOffsets.current;
    const known = map[id];
    if (known != null && Math.abs(known - y) < 1) return;
    map[id] = y;
    if (pendingSection.current === id) fulfillPending();
  }

  const layoutFor = (id) => (e) => recordSectionOffset(id, e.nativeEvent.layout.y);

  function handlePausedBodyLayout(e) {
    pausedBodyOffset.current = e.nativeEvent.layout.y;
    if (BASELINE_SECTIONS.has(pendingSection.current)) fulfillPending();
  }

  const handleChapterLayout = (id) => (e) => {
    chapterOffsets.current[id] = e.nativeEvent.layout.y;
  };

  const chapterIds = chapters.map((c) => c.id);
  const activeChapter = chapterIds.includes(spiedChapter) ? spiedChapter : chapterIds[0];

  // Scroll-spy: the last chapter whose header has reached the top of the
  // viewport is current; at the very end of the scroll the last chapter is,
  // even when it is too short to reach the top.
  function handleScroll(e) {
    if (Date.now() < spyLockUntil.current) return;
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent || {};
    const y = contentOffset?.y ?? 0;
    let current = chapterIds[0];
    for (const id of chapterIds) {
      const top = chapterOffsets.current[id];
      if (top != null && top - y <= SPY_THRESHOLD) current = id;
    }
    if (layoutMeasurement && contentSize && y > 0
      && y + layoutMeasurement.height >= contentSize.height - 2) {
      current = chapterIds[chapterIds.length - 1];
    }
    if (current !== activeChapter) setSpiedChapter(current);
  }

  // Index tap: jump to the chapter header (animated unless reduce-motion). A
  // tap supersedes any deep link still waiting for its layout.
  function handleChapterSelect(id) {
    const y = chapterOffsets.current[id];
    setSpiedChapter(id);
    if (y == null) return;
    pendingSection.current = null;
    spyLockUntil.current = Date.now() + (reduceMotion ? 50 : SPY_LOCK_MS);
    scrollRef.current?.scrollTo({ y, animated: !reduceMotion });
  }

  return {
    scrollRef,
    activeChapter,
    handleScroll,
    handleChapterSelect,
    handleChapterLayout,
    handlePausedBodyLayout,
    layoutFor,
  };
}
