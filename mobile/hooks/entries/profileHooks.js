import { useState, useEffect, useCallback, useRef } from 'react';
import * as Storage from '../../storage/entries';
import { safeNotify } from './shared';

let profileListeners = [];
const notifyProfile = () => safeNotify(profileListeners);

// Reload fan-out for external writes (sync pull, backup import) (#1480). The
// listeners are the instances' read-only refresh, so this cannot write or loop.
export const reloadUserProfile = () => safeNotify(profileListeners);

export function useUserProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Only the newest read (or write) may apply, and nothing applies after
  // unmount, so a slow older read cannot overwrite fresher persisted data.
  const seq = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    const mine = ++seq.current;
    return Storage.loadUserProfile()
      .then((next) => {
        if (mounted.current && mine === seq.current) setProfile(next);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted.current && mine === seq.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    profileListeners.push(refresh);
    return () => {
      mounted.current = false;
      profileListeners = profileListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const save = useCallback(async (profile_data) => {
    const saved = await Storage.saveUserProfile(profile_data);
    seq.current += 1;
    setProfile(saved);
    notifyProfile();
    return saved;
  }, []);

  const clear = useCallback(async () => {
    await Storage.clearUserProfile();
    seq.current += 1;
    setProfile(null);
    notifyProfile();
  }, []);

  return { profile, loading, save, clear };
}
