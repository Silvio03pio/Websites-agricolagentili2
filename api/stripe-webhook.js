import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import getRawBody from "raw-body";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeKey || !webhookSecret || !supabaseUrl || !serviceKey) {
    return res.status(500).json({
      ok: false,
      error: "Server misconfigured (missing env)",
      details: {
        hasStripeKey: Boolean(stripeKey),
        hasWebhookSecret: Boolean(webhookSecret),
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceKey: Boolean(serviceKey),
      },
    });
  }

  const stripe = new Stripe(stripeKey);
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const rawBody = await getRawBody(req); // Buffer raw, fondamentale
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // questo è l'errore che vedi ora
    return res.status(400).send("Webhook signature verification failed");
  }

  try {
    // idempotenza evento
    const { data: existing } = await supabaseAdmin
      .from("stripe_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();

    if (existing?.id) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    await supabaseAdmin.from("stripe_events").insert({ id: event.id });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const userId = session?.metadata?.user_id || null;
      const role = session?.metadata?.role || "customer";

      if (!userId) {
        // orders.user_id è NOT NULL: se manca qui, non potrà inserire
        return res.status(500).json({ received: false, error: "Missing metadata.user_id" });
      }

      // line items con metadata del product (per product_id Supabase)
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ["data.price.product"],
      });

      const paymentStatus = session.payment_status || null;
      const amountTotal = session.amount_total || 0;
      const currency = (session.currency || "eur").toUpperCase();
      const customerEmail = session.customer_details?.email || session.customer_email || null;

      const status = paymentStatus === "paid" ? "paid" : "created";

      // inserisci/aggiorna ordine
      const orderPayload = {
        user_id: userId,
        role,
        customer_email: customerEmail,
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent || null,
        amount_total_cents: amountTotal,
        currency,
        payment_status: paymentStatus,
        status,
        updated_at: new Date().toISOString(),
      };

      // insert o update by unique stripe_session_id
      let orderId = null;

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("orders")
        .insert(orderPayload)
        .select("id")
        .maybeSingle();

      if (!insErr) {
        orderId = inserted?.id;
      } else {
        const { data: existingOrder } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("stripe_session_id", session.id)
          .single();

        orderId = existingOrder.id;

        await supabaseAdmin.from("orders").update(orderPayload).eq("id", orderId);
      }

      // inserisci items se non già presenti
      const { data: existingItems } = await supabaseAdmin
        .from("order_items")
        .select("id")
        .eq("order_id", orderId)
        .limit(1);

      if (!existingItems || existingItems.length === 0) {
        const itemsToInsert = (lineItems.data || []).map(li => {
          const stripeProduct = li?.price?.product; // oggetto grazie all'expand
          const supabaseProductId = stripeProduct?.metadata?.product_id || null;

          return {
            order_id: orderId,
            product_id: supabaseProductId, // UUID Supabase (se presente)
            name_snapshot: li.description || stripeProduct?.name || "Prodotto",
            unit_amount_cents: li.price?.unit_amount ?? 0,
            qty: li.quantity || 1,
            currency: (li.currency || session.currency || "eur").toUpperCase(),
          };
        });

        await supabaseAdmin.from("order_items").insert(itemsToInsert);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[WEBHOOK ERROR]", err?.message || err);
    return res.status(500).send("Webhook handler failed");
  }
}
