import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function buildBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function normalizeVat(vat) {
  const v = String(vat || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^(?:[A-Z]{2})?[A-Z0-9]{8,20}$/.test(v)) return null;
  return v;
}

function normalizeISO2(c) {
  const v = String(c || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(v)) return null;
  return v;
}

const EU = new Set(["AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"]);

function parseVat(vat, fallbackCountryISO2) {
  const m = /^([A-Z]{2})([A-Z0-9]{6,})$/.exec(vat);
  if (m) return { countryCode: m[1], vatNumber: m[2] };
  const fc = normalizeISO2(fallbackCountryISO2);
  if (!fc) return null;
  return { countryCode: fc, vatNumber: vat };
}

// VIES SOAP check (UE)
async function viesCheck(countryCode, vatNumber) {
  const url = "https://ec.europa.eu/taxation_customs/vies/services/checkVatService";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <checkVat xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
      <countryCode>${countryCode}</countryCode>
      <vatNumber>${vatNumber}</vatNumber>
    </checkVat>
  </soap:Body>
</soap:Envelope>`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: xml,
      signal: ctrl.signal,
    });
    const text = await r.text();
    const validMatch = /<valid>\s*(true|false)\s*<\/valid>/i.exec(text);
    const valid = validMatch ? validMatch[1].toLowerCase() === "true" : null;

    return { ok: true, valid };
  } catch (e) {
    return { ok: false, valid: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function safeSend(resend, payload) {
  try {
    const { error } = await resend.emails.send(payload);
    if (error) console.error("[RESEND ERROR]", error);
  } catch (e) {
    console.error("[RESEND EXCEPTION]", e?.message || e);
  }
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const resendKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.RETAILER_FROM_EMAIL || process.env.CONTACT_FROM_EMAIL || "";
  const teamEmail = process.env.RETAILER_TEAM_EMAIL || process.env.CONTACT_TO_EMAIL || "";

  // se VAT non UE/non verificabile → rejected con motivo (così niente frodi)
  const AUTO_APPROVE_UNVERIFIED = String(process.env.AUTO_APPROVE_UNVERIFIED || "false").toLowerCase() === "true";

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured (Supabase env missing)" });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Unauthorized (missing Bearer token)" });

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);
  const resend = (resendKey && fromEmail) ? new Resend(resendKey) : null;

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // validate user session
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ ok: false, error: "Invalid session" });

    const user = userData.user;
    const userId = user.id;
    const userEmail = user.email || null;

    // BLOCCO reinvio se già pending
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("retailer_applications")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    if (exErr) return res.status(500).json({ ok: false, error: "DB error", details: exErr.message });
    if (existing?.status === "pending") {
      return res.status(409).json({ ok: false, error: "Application pending (resubmission disabled)", status: "pending" });
    }

    // fields
    const company_name = String(body.company_name || "").trim();
    const vat_number = normalizeVat(body.vat_number);
    const billing_country = normalizeISO2(body.billing_country || "IT");

    if (!company_name) return res.status(400).json({ ok: false, error: "Missing company_name" });
    if (!vat_number) return res.status(400).json({ ok: false, error: "Invalid vat_number" });
    if (!billing_country) return res.status(400).json({ ok: false, error: "Invalid billing_country (ISO2)" });

    const payload = {
      user_id: userId,
      company_name,
      vat_number,
      pec_email: String(body.pec_email || "").trim() || null,
      sdi_code: String(body.sdi_code || "").trim() || null,
      contact_name: String(body.contact_name || "").trim() || null,
      contact_phone: String(body.contact_phone || "").trim() || null,
      billing_line1: String(body.billing_line1 || "").trim() || null,
      billing_line2: String(body.billing_line2 || "").trim() || null,
      billing_city: String(body.billing_city || "").trim() || null,
      billing_postal_code: String(body.billing_postal_code || "").trim() || null,
      billing_state: String(body.billing_state || "").trim() || null,
      billing_country,
      status: "pending",
      approved_at: null,
      notes: null,
      updated_at: new Date().toISOString(),
    };

    // upsert (se era rejected può reinviare)
    const { error: upErr } = await supabaseAdmin
      .from("retailer_applications")
      .upsert(payload, { onConflict: "user_id" });

    if (upErr) return res.status(500).json({ ok: false, error: "Save failed", details: upErr.message });

    // verifica VAT
    const parsed = parseVat(vat_number, billing_country);
    const countryCode = parsed?.countryCode || null;
    const vatNumber = parsed?.vatNumber || null;

    let finalStatus = "pending";
    let reason = null;

    if (countryCode && vatNumber && EU.has(countryCode)) {
      const v = await viesCheck(countryCode, vatNumber);

      if (v.ok && v.valid === true) {
        finalStatus = "approved";
        reason = "VAT verificata (VIES).";
      } else if (v.ok && v.valid === false) {
        finalStatus = "rejected";
        reason = "VAT non valida (VIES).";
      } else {
        // VIES down -> pending
        finalStatus = "pending";
        reason = "Verifica VAT temporaneamente non disponibile (VIES).";
      }
    } else {
      if (AUTO_APPROVE_UNVERIFIED) {
        finalStatus = "approved";
        reason = "Auto-approvato (VAT non verificabile automaticamente).";
      } else {
        finalStatus = "rejected";
        reason = "VAT non verificabile automaticamente: inserisci prefisso paese UE (es. IT, DE, FR) oppure contatta supporto.";
      }
    }

    // update application status
    await supabaseAdmin
      .from("retailer_applications")
      .update({
        status: finalStatus,
        notes: reason,
        approved_at: finalStatus === "approved" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    // se approved -> role retailer
    if (finalStatus === "approved") {
      const { error: roleErr } = await supabaseAdmin
        .from("profiles")
        .update({ role: "retailer" })
        .eq("id", userId);

      if (roleErr) return res.status(500).json({ ok: false, error: "profiles.role update failed", details: roleErr.message });
    }

    // EMAIL
    const baseUrl = buildBaseUrl(req);
    const areaUrl = `${baseUrl}/area-rivenditori.html`;

    if (resend && userEmail) {
      if (finalStatus === "approved") {
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f6f6; padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="max-width:640px; margin:0 auto; background:#fff; border:1px solid #eee; border-radius:12px;">
              <tr>
                <td style="padding:18px 22px; border-bottom:1px solid #eee;">
                  <div style="font-size:18px; font-weight:700;">Accesso Rivenditori attivato</div>
                  <div style="color:#666; margin-top:4px;">Agricola Gentili</div>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 22px; font-size:14px;">
                  <p style="margin:0 0 10px;">La tua richiesta è stata approvata automaticamente.</p>
                  <p style="margin:0 0 10px;"><strong>Azienda:</strong> ${company_name}<br/>
                    <strong>VAT:</strong> ${vat_number}</p>
                  <div style="margin:16px 0;">
                    <a href="${areaUrl}"
                      style="display:inline-block; background:#111; color:#fff; text-decoration:none; padding:10px 14px; border-radius:10px;">
                      Entra nell’Area Rivenditori
                    </a>
                  </div>
                  <p style="margin:0; color:#666;">Se non sei loggato, ti verrà richiesto l’accesso.</p>
                  <p style="margin:18px 0 0; color:#999; font-size:12px;">Email automatica.</p>
                </td>
              </tr>
            </table>
          </div>
        `;
        await safeSend(resend, {
          from: fromEmail,
          to: [userEmail],
          subject: "Accesso Rivenditori attivato — Agricola Gentili",
          html,
        });
      }

      if (finalStatus === "rejected") {
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f6f6; padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="max-width:640px; margin:0 auto; background:#fff; border:1px solid #eee; border-radius:12px;">
              <tr>
                <td style="padding:18px 22px; border-bottom:1px solid #eee;">
                  <div style="font-size:18px; font-weight:700;">Richiesta Rivenditori rifiutata</div>
                  <div style="color:#666; margin-top:4px;">Agricola Gentili</div>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 22px; font-size:14px;">
                  <p style="margin:0 0 10px;">La tua richiesta non è stata approvata.</p>
                  <p style="margin:0 0 10px;"><strong>Motivo:</strong> ${reason || "-"}</p>
                  <p style="margin:0 0 10px;">Puoi tornare nell’Area Rivenditori, correggere i dati e reinviare.</p>
                  <div style="margin:16px 0;">
                    <a href="${areaUrl}"
                      style="display:inline-block; background:#111; color:#fff; text-decoration:none; padding:10px 14px; border-radius:10px;">
                      Torna al modulo Rivenditori
                    </a>
                  </div>
                  <p style="margin:18px 0 0; color:#999; font-size:12px;">Email automatica.</p>
                </td>
              </tr>
            </table>
          </div>
        `;
        await safeSend(resend, {
          from: fromEmail,
          to: [userEmail],
          subject: "Richiesta Rivenditori rifiutata — Agricola Gentili",
          html,
        });
      }

      if (finalStatus === "pending") {
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f6f6; padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="max-width:640px; margin:0 auto; background:#fff; border:1px solid #eee; border-radius:12px;">
              <tr>
                <td style="padding:18px 22px; border-bottom:1px solid #eee;">
                  <div style="font-size:18px; font-weight:700;">Richiesta Rivenditori in verifica</div>
                  <div style="color:#666; margin-top:4px;">Agricola Gentili</div>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 22px; font-size:14px;">
                  <p style="margin:0 0 10px;">La richiesta è stata ricevuta.</p>
                  <p style="margin:0 0 10px;">${reason || "Verifica VAT in corso."}</p>
                  <p style="margin:0;">Finché lo stato è PENDING non è possibile reinviare il modulo.</p>
                  <p style="margin:18px 0 0; color:#999; font-size:12px;">Email automatica.</p>
                </td>
              </tr>
            </table>
          </div>
        `;
        await safeSend(resend, {
          from: fromEmail,
          to: [userEmail],
          subject: "Richiesta Rivenditori in verifica — Agricola Gentili",
          html,
        });
      }
    }

    // team notify (opzionale)
    if (resend && teamEmail) {
      await safeSend(resend, {
        from: fromEmail,
        to: [teamEmail],
        subject: `Rivenditore: ${finalStatus.toUpperCase()} — ${company_name}`,
        html: `<p><strong>Esito:</strong> ${finalStatus}</p><p><strong>Azienda:</strong> ${company_name}</p><p><strong>VAT:</strong> ${vat_number}</p><p><strong>Motivo:</strong> ${reason || "-"}</p><p><strong>User:</strong> ${userId}</p><p><strong>Email:</strong> ${userEmail || "-"}</p>`,
      });
    }

    return res.status(200).json({ ok: true, status: finalStatus, reason });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Server error", details: String(e?.message || e) });
  }
}
