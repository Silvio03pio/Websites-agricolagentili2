import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export const config = {
  api: {
    bodyParser: false, // fondamentale: serve raw body per Stripe signature
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
    return res.status(500).send("Server misconfigured");
  }

  const stripe = new Stripe(stripeKey);
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("[WEBHOOK] signature verification failed:", err?.message || err);
    return res.status(400).send("Webhook signature verification failed");
  }

  try {
    // Idempotenza: se event.id già processato, rispondi 200
    const { data: existing } = await supabaseAdmin
      .from("stripe_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();

    if (existing?.id) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Registra subito l'evento come ricevuto (anti-doppioni)
    const { error: insEvtErr } = await supabaseAdmin
      .from("stripe_events")
      .insert({ id: event.id });

    if (insEvtErr) {
      // se per race condition è già stato inserito, ok lo stesso
      console.warn("[WEBHOOK] stripe_events insert:", insEvtErr.message);
    }

    // Gestione eventi
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      const session = event.data.object;

      // Nota: noi abbiamo messo metadata: user_id, role in create-checkout-session
      const userId = session?.metadata?.user_id || null;
      const role = session?.metadata?.role || "customer";

      // Recupero line items da Stripe (source of truth pagamento)
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });

      const paymentStatus = session.payment_status || null;
      const amountTotal = session.amount_total || 0;
      const currency = (session.currency || "eur").toUpperCase();
      const customerEmail = session.customer_details?.email || session.customer_email || null;

      // Stato interno
      let status = "created";
      if (event.type === "checkout.session.async_payment_failed") status = "failed";
      else if (paymentStatus === "paid") status = "paid";
      else status = "created";

      // Upsert ordine (chiave unica: stripe_session_id)
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

      // Inserisci se non esiste
      const { data: inserted, error: ordErr } = await supabaseAdmin
        .from("orders")
        .insert(orderPayload)
        .select("id")
        .maybeSingle();

      let orderId = inserted?.id;

      if (ordErr) {
        // Se esiste già, recupera id e aggiorna stato
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

      // Inserisci items solo se non esistono già per quell'ordine
      // (semplice: se già presenti, skip)
      const { data: existingItems } = await supabaseAdmin
        .from("order_items")
        .select("id")
        .eq("order_id", orderId)
        .limit(1);

      if (!existingItems || existingItems.length === 0) {
        const itemsToInsert = (lineItems.data || []).map(li => ({
          order_id: orderId,
          product_id: li.price?.product || null, // non sempre disponibile come uuid: meglio tenere snapshot
          name_snapshot: li.description || "Prodotto",
          unit_amount_cents: li.price?.unit_amount ?? 0,
          qty: li.quantity || 1,
          currency: (li.currency || session.currency || "eur").toUpperCase(),
        }));

        if (itemsToInsert.length) {
          const { error: itemsErr } = await supabaseAdmin
            .from("order_items")
            .insert(itemsToInsert);

          if (itemsErr) throw itemsErr;
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[WEBHOOK] handler error:", err?.message || err);
    return res.status(500).send("Webhook handler failed");
  }
}
