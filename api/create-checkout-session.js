export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Caricamento librerie in modo sicuro (evita crash "muto")
  let Stripe, createClient;
  try {
    ({ default: Stripe } = await import("stripe"));
    ({ createClient } = await import("@supabase/supabase-js"));
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Server init failed (missing dependency or import error)",
      details: String(e?.message || e),
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: "Server misconfigured (Supabase env missing)" });
    }
    if (!stripeKey) {
      return res.status(500).json({ ok: false, error: "Server misconfigured (Stripe env missing)" });
    }

    // Auth: checkout SOLO loggati
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Unauthorized (missing Bearer token)" });

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(stripeKey);

    // parse body robusto
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, error: "Empty cart" });

    // valida token e ottieni user
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid session", details: userErr?.message || null });
    }
    const userId = userData.user.id;

    // ruolo
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profErr) {
      return res.status(500).json({ ok: false, error: "Profiles query failed", details: profErr.message });
    }

    const role = profile?.role || "customer";
    const isRetailer = role === "retailer";

    // normalizza qty
    const normalized = items
      .map(i => ({
        productId: i?.productId,
        qty: Math.max(0, Math.min(99, Math.floor(Number(i?.qty || 0))))
      }))
      .filter(i => i.productId && i.qty > 0);

    if (!normalized.length) return res.status(400).json({ ok: false, error: "Empty cart (no valid items)" });

    const ids = [...new Set(normalized.map(i => i.productId))];

    // carica prodotti
    const { data: products, error: prodErr } = await supabaseAdmin
      .from("products")
      .select("id, name, price_cents, currency, active")
      .in("id", ids);

    if (prodErr) {
      return res.status(500).json({ ok: false, error: "Products query failed", details: prodErr.message });
    }

    const map = new Map((products || []).map(p => [p.id, p]));

    const line_items = normalized.map(({ productId, qty }) => {
      const p = map.get(productId);
      if (!p || p.active !== true) return null;

      const base = Number(p.price_cents);
      const unit = isRetailer ? Math.round((base * 90) / 100) : base;

      return {
        quantity: qty,
        price_data: {
          currency: (p.currency || "EUR").toLowerCase(),
          unit_amount: unit,
          product_data: {
            name: p.name,
            metadata: { product_id: p.id }
          }
        }
      };
    }).filter(Boolean);

    if (!line_items.length) {
      return res.status(400).json({ ok: false, error: "No purchasable items (inactive/missing products)" });
    }

    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${baseUrl}/success.html`,
      cancel_url: `${baseUrl}/cancel.html`,
      metadata: { user_id: userId, role }
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    // Errore runtime/Stripe
    return res.status(500).json({
      ok: false,
      error: "Server error",
      details: String(e?.message || e),
      // Stripe spesso espone "type" utile
      type: e?.type || null,
    });
  }
}
