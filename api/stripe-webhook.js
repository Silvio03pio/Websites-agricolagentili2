import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import getRawBody from "raw-body";

// FONDAMENTALE: Stripe signature vuole i bytes raw, non body parsato
export const config = {
  api: {
    bodyParser: false,
  },
};

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
    if (!sig) {
      return res.status(400).json({
        ok: false,
        error: "Missing Stripe-Signature header",
      });
    }

    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // IMPORTANT: restituiamo dettagli per capire se è whsec errato o body alterato
    return res.status(400).json({
      ok: false,
      error: "Webhook signature verification failed",
      details: String(err?.message || err),
    });
  }

  try {
    // idempotenza evento
    const { data: existing } = await supabaseAdmin
      .from("stripe_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();

    if (existing?.id) {
      return res.status(200).json({ ok: true, received: true, duplicate: true });
    }

    await supabaseAdmin.from("stripe_events").insert({ id: event.id });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const userId = session?.metadata?.user_id || null;
      const role = session?.metadata?.role || "customer";

      if (!userId) {
        return res.status(500).json({
          ok: false,
          error: "Missing session.metadata.user_id",
          details: { session_id: session?.id || null, metadata: session?.metadata || null },
        });
      }

      // Line items + metadata prodotto (product_id Supabase)
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ["data.price.product"],
      });

      const paymentStatus = session.payment_status || null;
      const amountTotal = session.amount_total || 0;
      const currency = (session.currency || "eur").toUpperCase();
      const customerEmail = session.customer_details?.email || session.customer_email || null;

      const status = paymentStatus === "paid" ? "paid" : "created";

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

      // insert o update by stripe_session_id
      let orderId = null;

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("orders")
        .insert(orderPayload)
        .select("id")
        .maybeSingle();

      if (!insErr) {
        orderId = inserted?.id;
      } else {
        const { data: existingOrder, error: selErr } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("stripe_session_id", session.id)
          .single();

        if (selErr) throw selErr;

        orderId = existingOrder.id;

        const { error: updErr } = await supabaseAdmin
          .from("orders")
          .update(orderPayload)
          .eq("id", orderId);

        if (updErr) throw updErr;
      }

      // Inserisci items solo se non presenti
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
            product_id: supabaseProductId, // UUID Supabase
            name_snapshot: li.description || stripeProduct?.name || "Prodotto",
            unit_amount_cents: li.price?.unit_amount ?? 0,
            qty: li.quantity || 1,
            currency: (li.currency || session.currency || "eur").toUpperCase(),
          };
        });

        const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(itemsToInsert);
        if (itemsErr) throw itemsErr;
      }
    }

    return res.status(200).json({ ok: true, received: true, event_type: event.type });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Webhook handler failed",
      details: String(err?.message || err),
      event_type: event?.type || null,
    });
  }
}
