const SCHEMA = 'kilo';

let injectedTransport = null;

export function setCloudTransport(transport) {
  injectedTransport = transport;
}

function makeSupabaseTransport() {
  // eslint-disable-next-line global-require
  const { getSupabaseClient } = require('../../lib/supabaseClient');
  return {
    async pull(table, cursor) {
      const client = getSupabaseClient();
      if (!client) return [];
      let query = client.schema(SCHEMA).from(table).select('*');
      if (cursor) query = query.gte('updated_at', cursor);
      const { data, error } = await query.order('updated_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async push(table, records) {
      const client = getSupabaseClient();
      if (!client) throw new Error('Cloud sync requires a configured Supabase client.');
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Cloud sync requires an authenticated user.');
      const rows = records.map((rec) => ({ ...rec, user_id: userId }));
      const { error } = await client.schema(SCHEMA).from(table).upsert(rows, { onConflict: 'user_id,id' });
      if (error) throw error;
    },
  };
}

export function getTransport() {
  return injectedTransport || makeSupabaseTransport();
}

let recomputeDerivedFn = (raw_text) => {
  // eslint-disable-next-line global-require
  const { parseWorkoutNote } = require('../../lib/parser');
  const { sections } = parseWorkoutNote(raw_text || '');
  return { derived_sections: sections };
};

export function setRecomputeDerived(fn) {
  recomputeDerivedFn = typeof fn === 'function' ? fn : recomputeDerivedFn;
}

export function getRecomputeDerived() {
  return recomputeDerivedFn;
}
