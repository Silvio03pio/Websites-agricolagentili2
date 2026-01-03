import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function asIntQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(99, Math.floor(n)));
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: "Server misconfigured (Supabase)" });
    }

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // valida token e ottieni user
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    const userId = userData.user.id;

    // leggi ruolo (default customer)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    const role = profile?.role || "customer";
    const isRetailer = role === "retailer";

    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, error: "Empty cart" });
    }

    // normalizza qty e ids
    const normalized = items
      .map(i => ({ productId: i.productId, qty: asIntQty(i.qty) }))
      .filter(i => i.productId && i.qty > 0);

    if (!normalized.length) {
      return res.status(400).json({ ok: false, error: "Empty cart" });
    }

    const ids = [...new Set(normalized.map(i => i.productId))];

    // carica prodotti dal DB (fonte di verità)
    const { data: products, error: prodErr } = await supabaseAdmin
      .from("products")
      .select("id, name, price_cents, currency, active")
      .in("id", ids);

    if (prodErr) {
      return res.status(500).json({ ok: false, error: "Products query failed" });
    }

    const map = new Map((products || []).map(p => [p.id, p]));

    // costruisci line items Stripe
    const line_items = normalized.map(({ productId, qty }) => {
      const p = map.get(productId);
      if (!p || p.active !== true) return null;

      const base = Number(p.price_cents);
      const unitAmount = isRetailer ? Math.round((base * 90) / 100) : base;

      return {
        quantity: qty,
        price_data: {
          currency: (p.currency || "EUR").toLowerCase(),
          unit_amount: unitAmount,
          product_data: {
            name: p.name,
            metadata: { product_id: p.id }
          }
        }
      };
    }).filter(Boolean);

    if (!line_items.length) {
      return res.status(400).json({ ok: false, error: "No purchasable items" });
    }

    const baseUrl = getBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${baseUrl}/success.html`,
      cancel_url: `${baseUrl}/cancel.html`,
      metadata: {
        user_id: userId,
        role
      }
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
