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

  function isValidEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
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

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(stripeKey);

    // Parse body robusto
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const items = Array.isArray(body.items) ? body.items : [];

    if (!items.length) {
      return res.status(400).json({ ok: false, error: "Empty cart" });
    }

    // Normalizza qty
    const normalized = items
      .map(i => ({
        productId: i?.productId,
        qty: Math.max(0, Math.min(99, Math.floor(Number(i?.qty || 0))))
      }))
      .filter(i => i.productId && i.qty > 0);

    if (!normalized.length) {
      return res.status(400).json({ ok: false, error: "Empty cart (no valid items)" });
    }

    // ====== AUTH / FALLBACK LOGIC ======
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    let userId = null;
    let userEmail = null;
    let role = "customer";
    let isRetailer = false;
    let isGuestFallback = false;

    if (token) {
      // Valida token e ottieni user
      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
      if (userErr || !userData?.user) {
        return res.status(401).json({ ok: false, error: "Invalid session", details: userErr?.message || null });
      }

      const user = userData.user;
      userId = user.id;
      userEmail = user.email || null;

      // Email confermata?
      const emailConfirmedAt = user.email_confirmed_at || user.confirmed_at || null;
      const isEmailConfirmed = Boolean(emailConfirmedAt);

      // Se email NON confermata -> blocchiamo checkout auth e forziamo fallback guest lato client
      if (!isEmailConfirmed) {
        return res.status(403).json({
          ok: false,
          error: "Email not confirmed",
          details: "Conferma l’email oppure procedi come ospite inserendo un’email nel carrello.",
        });
      }

      // Ruolo (source of truth server-side)
      const { data: profile, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (profErr) {
        return res.status(500).json({ ok: false, error: "Profiles query failed", details: profErr.message });
      }

      role = profile?.role || "customer";
      isRetailer = role === "retailer";

    } else {
      // Nessun token -> NON è checkout guest "di default"
      // Consentiamo SOLO se arriva guest_email (fallback esplicito dal carrello).
      const guestEmail = (body.guest_email || "").trim();
      if (!isValidEmail(guestEmail)) {
        return res.status(401).json({
          ok: false,
          error: "Unauthorized",
          details: "Login required. If you cannot login, provide guest_email for fallback checkout.",
        });
      }

      isGuestFallback = true;
      userEmail = guestEmail;
      role = "customer";
      isRetailer = false;
    }

    // ====== PRODUCTS (source of truth) ======
    const ids = [...new Set(normalized.map(i => i.productId))];

    const { data: products, error: prodErr } = await supabaseAdmin
      .from("products")
      .select("id, name, price_cents, currency, active")
      .in("id", ids);

    if (prodErr) {
      return res.status(500).json({ ok: false, error: "Products query failed", details: prodErr.message });
    }

    const map = new Map((products || []).map(p => [p.id, p]));

    const line_items = normalized
      .map(({ productId, qty }) => {
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
              // IMPORTANT: UUID Supabase per ricostruire order_items nel webhook
              metadata: { product_id: p.id },
            },
          },
        };
      })
      .filter(Boolean);

    if (!line_items.length) {
      return res.status(400).json({ ok: false, error: "No purchasable items (inactive/missing products)" });
    }

    // ====== URLS ======
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    // ====== STRIPE SESSION ======
    const metadata = {
      role,
      ...(userId ? { user_id: userId } : {}),
      ...(userEmail ? { customer_email: userEmail } : {}),
      ...(isGuestFallback ? { is_guest: "true" } : { is_guest: "false" }),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,

      // Post-payment verification (success.js / order-status)
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,

      // Tracciabilità
      ...(userId ? { client_reference_id: userId } : {}),

      // Email per ricevute e conferma ordine (fondamentale anche per guest fallback)
      ...(userEmail ? { customer_email: userEmail } : {}),

      // INDIRIZZO SPEDIZIONE (per prodotti fisici)
      shipping_address_collection: {
        // Default IT. Se spedisci anche fuori Italia, aggiungi i paesi qui.
        allowed_countries: ["IT"],
      },
      // Facoltativo ma utile
      phone_number_collection: { enabled: true },

      metadata,
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      details: String(e?.message || e),
      type: e?.type || null,
    });
  }
}
