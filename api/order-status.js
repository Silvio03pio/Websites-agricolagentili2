import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const sessionId = req.query?.session_id;
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: "Missing session_id" });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  // valida user
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Invalid session" });
  }

  const userId = userData.user.id;

  const { data: order, error: ordErr } = await supabaseAdmin
    .from("orders")
    .select("id, stripe_session_id, amount_total_cents, currency, status, payment_status, created_at")
    .eq("stripe_session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (ordErr) return res.status(500).json({ ok: false, error: "Query failed" });
  if (!order) return res.status(404).json({ ok: false, error: "Order not found yet" });

  return res.status(200).json({ ok: true, order });
}
