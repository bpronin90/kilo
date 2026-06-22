import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { safeNotify } from './shared';

let profileListeners = [];
const notifyProfile = () => safeNotify(profileListeners);

export function useUserProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    Storage.loadUserProfile()
      .then(setProfile)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    profileListeners.push(refresh);
    return () => {
      profileListeners = profileListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const save = useCallback(async (profile_data) => {
    const saved = await Storage.saveUserProfile(profile_data);
    setProfile(saved);
    notifyProfile();
    return saved;
  }, []);

  const clear = useCallback(async () => {
    await Storage.clearUserProfile();
    setProfile(null);
    notifyProfile();
  }, []);

  return { profile, loading, save, clear };
}
