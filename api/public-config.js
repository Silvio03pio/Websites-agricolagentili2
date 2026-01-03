export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  const debug = {
    vercelEnv: process.env.VERCEL_ENV || null,          // production / preview / development
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasSupabaseAnonKey: Boolean(supabaseAnonKey),
  };

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY", debug });
  }

  // L'anon key è pubblica; serve al browser.
  return res.status(200).json({
    ok: true,
    supabaseUrl,
    supabaseAnonKey,
    debug,
  });
}
