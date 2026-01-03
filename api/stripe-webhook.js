import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import getRawBody from "raw-body";
import { Resend } from "resend";

// FONDAMENTALE: Stripe signature vuole i bytes raw, non body parsato
export const config = {
  api: { bodyParser: false },
};

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(cents, currency = "EUR") {
  const amount = (Number(cents || 0) / 100).toFixed(2);
  return `${amount} ${String(currency || "EUR").toUpperCase()}`;
}

function buildBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}

function normalizeLineItems(session, lineItems) {
  return (lineItems?.data || []).map((li) => {
    const stripeProduct = li?.price?.product;
    const supabaseProductId =
      typeof stripeProduct === "object" ? stripeProduct?.metadata?.product_id || null : null;

    return {
      product_id: supabaseProductId,
      name: li.description || (typeof stripeProduct === "object" ? stripeProduct?.name : null) || "Prodotto",
      qty: li.quantity || 1,
      unit_amount_cents: li.price?.unit_amount ?? 0,
      currency: (li.currency || session.currency || "eur").toUpperCase(),
    };
  });
}

function formatAddressLines(addr) {
  if (!addr) return [];
  const parts = [];
  const line1 = addr.line1 || "";
  const line2 = addr.line2 || "";
  const city = addr.city || "";
  const state = addr.state || "";
  const postal = addr.postal_code || "";
  const country = addr.country || "";

  if (line1) parts.push(line1);
  if (line2) parts.push(line2);

  const cityLine = [postal, city].filter(Boolean).join(" ");
  const regionLine = [state, country].filter(Boolean).join(" ");
  if (cityLine) parts.push(cityLine);
  if (regionLine) parts.push(regionLine);

  return parts;
}

function buildTeamEmailHtml({ orderId, session, role, items, baseUrl }) {
  const customerEmail = session?.customer_details?.email || session?.customer_email || "-";
  const total = formatMoney(session.amount_total, (session.currency || "eur").toUpperCase());
  const sessionId = session?.id || "-";

  const shipping = session?.shipping_details || null;
  const shipName = shipping?.name || session?.customer_details?.name || "-";
  const shipPhone = session?.customer_details?.phone || "-";
  const shipAddrLines = formatAddressLines(shipping?.address);
  const shipAddrHtml = shipAddrLines.length
    ? shipAddrLines.map(l => `<div>${escapeHtml(l)}</div>`).join("")
    : `<div style="color:#999;">(non disponibile)</div>`;

  const rows = items.length
    ? items.map(i => `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #eee;">
          ${escapeHtml(i.name)}
          ${i.product_id ? `<div style="color:#999; font-size:12px; margin-top:2px;">ID prodotto: ${escapeHtml(i.product_id)}</div>` : ``}
        </td>
        <td style="padding:8px 0; border-bottom:1px solid #eee; text-align:center;">${i.qty}</td>
        <td style="padding:8px 0; border-bottom:1px solid #eee; text-align:right;">${escapeHtml(formatMoney(i.unit_amount_cents, i.currency))}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3" style="padding:10px 0; color:#666;">(Nessuna riga)</td></tr>`;

  const totalRow = `
    <tr>
      <td style="padding:10px 0; text-align:right; border-top:2px solid #eee;" colspan="2"><strong>Totale</strong></td>
      <td style="padding:10px 0; text-align:right; border-top:2px solid #eee;"><strong>${escapeHtml(total)}</strong></td>
    </tr>
  `;

  const successUrl = `${baseUrl}/success.html?session_id=${encodeURIComponent(sessionId)}`;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f6f6; padding:24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #eee; border-radius:12px;">
      <tr>
        <td style="padding:18px 22px; border-bottom:1px solid #eee;">
          <div style="font-size:18px; font-weight:700;">Nuovo ordine pagato</div>
          <div style="color:#666; margin-top:4px;">Agricola Gentili</div>
        </td>
      </tr>

      <tr>
        <td style="padding:18px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
            <tr><td style="padding:2px 0; color:#666;">Order ID (Supabase)</td><td style="padding:2px 0; text-align:right;"><strong>${escapeHtml(orderId)}</strong></td></tr>
            <tr><td style="padding:2px 0; color:#666;">Stripe session</td><td style="padding:2px 0; text-align:right;"><strong>${escapeHtml(sessionId)}</strong></td></tr>
            <tr><td style="padding:2px 0; color:#666;">Cliente (email)</td><td style="padding:2px 0; text-align:right;"><strong>${escapeHtml(customerEmail)}</strong></td></tr>
            <tr><td style="padding:2px 0; color:#666;">Tipo</td><td style="padding:2px 0; text-align:right;"><strong>${escapeHtml(role === "retailer" ? "Rivenditore" : "Cliente")}</strong></td></tr>
            <tr><td style="padding:2px 0; color:#666;">Totale</td><td style="padding:2px 0; text-align:right;"><strong>${escapeHtml(total)}</strong></td></tr>
          </table>

          <div style="margin-top:16px; font-weight:700;">Spedizione</div>
          <div style="margin-top:6px; font-size:14px;">
            <div><strong>${escapeHtml(shipName)}</strong></div>
            <div style="opacity:.9;">Tel: ${escapeHtml(shipPhone)}</div>
            <div style="margin-top:6px;">${shipAddrHtml}</div>
          </div>

          <div style="margin-top:16px; font-weight:700;">Righe ordine</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px; font-size:14px;">
            <thead>
              <tr>
                <th align="left" style="padding:8px 0; border-bottom:2px solid #eee;">Prodotto</th>
                <th align="center" style="padding:8px 0; border-bottom:2px solid #eee;">Qtà</th>
                <th align="right" style="padding:8px 0; border-bottom:2px solid #eee;">Prezzo</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              ${totalRow}
            </tbody>
          </table>

          <div style="margin-top:18px;">
            <a href="${successUrl}" style="display:inline-block; background:#111; color:#fff; text-decoration:none; padding:10px 14px; border-radius:10px; font-size:14px;">
              Apri pagina ordine (debug)
            </a>
          </div>

          <div style="margin-top:14px; color:#999; font-size:12px;">
            Email automatica dal sistema ordini (Stripe webhook).
          </div>
        </td>
      </tr>
    </table>
  </div>`;
}

function buildCustomerEmailHtml({ orderId, session, items }) {
  const total = formatMoney(session.amount_total, (session.currency || "eur").toUpperCase());

  const shipping = session?.shipping_details || null;
  const shipName = shipping?.name || session?.customer_details?.name || "";
  const shipAddrLines = formatAddressLines(shipping?.address);

  const rows = items.length
    ? items.map(i => `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #eee;">${escapeHtml(i.name)}</td>
        <td style="padding:8px 0; border-bottom:1px solid #eee; text-align:center;">${i.qty}</td>
        <td style="padding:8px 0; border-bottom:1px solid #eee; text-align:right;">${escapeHtml(formatMoney(i.unit_amount_cents, i.currency))}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3" style="padding:10px 0; color:#666;">(Nessuna riga)</td></tr>`;

  const totalRow = `
    <tr>
      <td style="padding:10px 0; text-align:right; border-top:2px solid #eee;" colspan="2"><strong>Totale</strong></td>
      <td style="padding:10px 0; text-align:right; border-top:2px solid #eee;"><strong>${escapeHtml(total)}</strong></td>
    </tr>
  `;

  const shipBlock = shipAddrLines.length
    ? `
      <div style="margin-top:14px; font-weight:700;">Indirizzo di spedizione</div>
      <div style="margin-top:6px;">
        ${shipName ? `<div><strong>${escapeHtml(shipName)}</strong></div>` : ``}
        ${shipAddrLines.map(l => `<div>${escapeHtml(l)}</div>`).join("")}
      </div>
    `
    : ``;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f6f6; padding:24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #eee; border-radius:12px;">
      <tr>
        <td style="padding:18px 22px; border-bottom:1px solid #eee;">
          <div style="font-size:18px; font-weight:700;">Conferma ordine</div>
          <div style="color:#666; margin-top:4px;">Agricola Gentili</div>
        </td>
      </tr>

      <tr>
        <td style="padding:18px 22px; font-size:14px;">
          <p style="margin:0 0 10px;">Ciao,</p>
          <p style="margin:0 0 10px;">grazie per il tuo acquisto. Abbiamo ricevuto correttamente il pagamento.</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0; font-size:14px;">
            <tr><td style="padding:2px 0; color:#666;">Riferimento ordine</td><td style="padding:2px 0; text-align:right;"><strong>${escapeHtml(orderId)}</strong></td></tr>
            <tr><td style="padding:2px 0; color:#666;">Totale</td><td style="padding:2px 0; text-align:right;"><strong>${escapeHtml(total)}</strong></td></tr>
          </table>

          ${shipBlock}

          <div style="margin-top:16px; font-weight:700;">Riepilogo prodotti</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px; font-size:14px;">
            <thead>
              <tr>
                <th align="left" style="padding:8px 0; border-bottom:2px solid #eee;">Prodotto</th>
                <th align="center" style="padding:8px 0; border-bottom:2px solid #eee;">Qtà</th>
                <th align="right" style="padding:8px 0; border-bottom:2px solid #eee;">Prezzo</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              ${totalRow}
            </tbody>
          </table>

          <p style="margin:16px 0 0; color:#666;">
            Per assistenza, rispondi a questa email.
          </p>

          <p style="margin:18px 0 0; color:#999; font-size:12px;">
            Questa è un’email automatica di conferma ordine.
          </p>
        </td>
      </tr>
    </table>
  </div>`;
}

async function safeSendEmail(resend, payload) {
  try {
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      console.error("[RESEND ERROR]", error);
      return { ok: false, error };
    }
    return { ok: true, id: data?.id || null };
  } catch (e) {
    console.error("[RESEND EXCEPTION]", e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

function pickShippingFromSession(session) {
  const customer = session?.customer_details || {};
  const shipping = session?.shipping_details || {};

  const shipAddr = shipping?.address || null;
  const billAddr = customer?.address || null;

  return {
    customer_name: customer?.name || null,
    customer_phone: customer?.phone || null,

    shipping_name: shipping?.name || customer?.name || null,
    shipping_phone: customer?.phone || null, // Stripe mette il telefono su customer_details

    shipping_address_line1: shipAddr?.line1 || null,
    shipping_address_line2: shipAddr?.line2 || null,
    shipping_city: shipAddr?.city || null,
    shipping_state: shipAddr?.state || null,
    shipping_postal_code: shipAddr?.postal_code || null,
    shipping_country: shipAddr?.country || null,

    shipping_address: shipAddr ? shipAddr : null,
    billing_address: billAddr ? billAddr : null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  // ENV essenziali
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

  // 1) Verifica firma Stripe (RAW BODY)
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).json({ ok: false, error: "Missing Stripe-Signature header" });
    }

    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: "Webhook signature verification failed",
      details: String(err?.message || err),
    });
  }

  try {
    // 2) Idempotenza evento
    const { data: existingEvent, error: existingEventErr } = await supabaseAdmin
      .from("stripe_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();

    if (existingEventErr) {
      return res.status(500).json({
        ok: false,
        error: "stripe_events query failed",
        details: existingEventErr.message,
      });
    }

    if (existingEvent?.id) {
      return res.status(200).json({ ok: true, received: true, duplicate: true });
    }

    const { error: insEventErr } = await supabaseAdmin.from("stripe_events").insert({ id: event.id });
    if (insEventErr) {
      return res.status(500).json({ ok: false, error: "stripe_events insert failed", details: insEventErr.message });
    }

    // 3) Gestione evento
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const role = session?.metadata?.role || "customer";
      const paymentStatus = (session.payment_status || "").toLowerCase();

      // user_id può mancare in guest fallback -> lo gestiamo
      const userId = session?.metadata?.user_id || null;

      // email: preferisci customer_details.email, poi metadata.customer_email (fallback), poi customer_email
      const customerEmail =
        session?.customer_details?.email ||
        session?.metadata?.customer_email ||
        session?.customer_email ||
        null;

      const amountTotal = session.amount_total || 0;
      const currency = (session.currency || "eur").toUpperCase();

      const status = paymentStatus === "paid" ? "paid" : "created";

      // Line items + product metadata (product_id Supabase)
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ["data.price.product"],
      });

      const itemsNorm = normalizeLineItems(session, lineItems);

      // Campi spedizione/billing da Stripe
      const shippingFields = pickShippingFromSession(session);

      // Dati ordine (base)
      const orderPayloadBase = {
        user_id: userId, // può essere null se guest fallback (DB deve accettarlo, se vuoi ti do migration)
        role,
        customer_email: customerEmail,
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent || null,
        amount_total_cents: amountTotal,
        currency,
        payment_status: session.payment_status || null,
        status,
        updated_at: new Date().toISOString(),
      };

      // Dati ordine (con spedizione)
      const orderPayload = { ...orderPayloadBase, ...shippingFields };

      // 4) Insert o update (by stripe_session_id)
      let orderId = null;

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("orders")
        .insert(orderPayload)
        .select("id")
        .maybeSingle();

      if (!insErr) {
        orderId = inserted?.id;
      } else {
        // se fallisce per colonne non presenti (migrazione non fatta), riprova con payload base
        const msg = String(insErr?.message || "");
        const missingColumn = msg.toLowerCase().includes("column") && msg.toLowerCase().includes("does not exist");

        // trova ordine esistente
        const { data: existingOrder, error: selErr } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("stripe_session_id", session.id)
          .single();

        if (selErr) throw selErr;
        orderId = existingOrder.id;

        const payloadToUpdate = missingColumn ? orderPayloadBase : orderPayload;
        const { error: updErr } = await supabaseAdmin.from("orders").update(payloadToUpdate).eq("id", orderId);
        if (updErr) throw updErr;
      }

      // 5) Inserisci items solo se non presenti
      const { data: existingItems, error: existingItemsErr } = await supabaseAdmin
        .from("order_items")
        .select("id")
        .eq("order_id", orderId)
        .limit(1);

      if (existingItemsErr) throw existingItemsErr;

      if (!existingItems || existingItems.length === 0) {
        const itemsToInsert = itemsNorm.map((i) => ({
          order_id: orderId,
          product_id: i.product_id,
          name_snapshot: i.name,
          unit_amount_cents: i.unit_amount_cents,
          qty: i.qty,
          currency: i.currency,
        }));

        const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(itemsToInsert);
        if (itemsErr) throw itemsErr;
      }

      // 6) Email (solo se paid) - non deve rompere il webhook
      if (paymentStatus === "paid") {
        const resendKey = process.env.RESEND_API_KEY;
        const from = process.env.ORDER_FROM_EMAIL || process.env.CONTACT_FROM_EMAIL || null;
        const toTeam = process.env.ORDER_TO_EMAIL || process.env.CONTACT_TO_EMAIL || null;

        if (resendKey && from && toTeam) {
          const resend = new Resend(resendKey);
          const baseUrl = buildBaseUrl(req);

          // Leggi flag invio se colonne esistono (idempotenza extra)
          let teamSentAt = null;
          let customerSentAt = null;

          try {
            const { data: o } = await supabaseAdmin
              .from("orders")
              .select("team_email_sent_at, customer_email_sent_at")
              .eq("id", orderId)
              .maybeSingle();
            teamSentAt = o?.team_email_sent_at || null;
            customerSentAt = o?.customer_email_sent_at || null;
          } catch {
            // colonne non presenti: ok, idempotenza principale è stripe_events
          }

          // Team
          if (!teamSentAt) {
            const subject = `Nuovo ordine pagato — ${formatMoney(amountTotal, currency)} — ${role === "retailer" ? "Rivenditore" : "Cliente"}`;
            const html = buildTeamEmailHtml({ orderId, session, role, items: itemsNorm, baseUrl });

            const teamSend = await safeSendEmail(resend, {
              from,
              to: [toTeam],
              subject,
              html,
            });

            if (teamSend.ok) {
              try {
                await supabaseAdmin.from("orders").update({ team_email_sent_at: new Date().toISOString() }).eq("id", orderId);
              } catch {}
            }
          }

          // Cliente (solo se email valida)
          if (isValidEmail(customerEmail) && !customerSentAt) {
            const subject = "Conferma ordine — Agricola Gentili";
            const html = buildCustomerEmailHtml({ orderId, session, items: itemsNorm });

            const customerSend = await safeSendEmail(resend, {
              from,
              to: [customerEmail],
              subject,
              html,
            });

            if (customerSend.ok) {
              try {
                await supabaseAdmin.from("orders").update({ customer_email_sent_at: new Date().toISOString() }).eq("id", orderId);
              } catch {}
            }
          }
        } else {
          console.warn("[ORDER EMAIL] Missing RESEND_API_KEY or ORDER_FROM_EMAIL/ORDER_TO_EMAIL (emails not sent)");
        }
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
