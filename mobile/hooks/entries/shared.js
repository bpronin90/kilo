export const safeNotify = (listeners) =>
  listeners.forEach(l => { try { l(); } catch (e) { console.warn('[useEntries] listener error', e); } });
