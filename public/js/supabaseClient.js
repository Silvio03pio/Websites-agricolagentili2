import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let _promise;

export async function getSupabase() {
  if (_promise) return _promise;

  _promise = (async () => {
    const r = await fetch("/api/public-config", { headers: { "accept": "application/json" } });
    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.supabaseUrl || !j.supabaseAnonKey) {
      throw new Error(j.error || "Cannot load Supabase public config");
    }

    return createClient(j.supabaseUrl, j.supabaseAnonKey, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  })();

  return _promise;
}
