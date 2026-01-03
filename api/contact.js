const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      name = "",
      email = "",
      phone = "",
      subject = "",
      message = "",
      privacy = false,
      website = "" // honeypot
    } = body;

    // Honeypot anti-bot
    if (String(website).trim().length > 0) {
      return res.status(200).json({ ok: true });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim();
    const cleanPhone = String(phone).trim();
    const cleanSubject = String(subject).trim();
    const cleanMessage = String(message).trim();

    if (!privacy) return res.status(400).json({ error: "Devi accettare la Privacy Policy." });
    if (!cleanName || !cleanEmail || !cleanSubject || !cleanMessage) {
      return res.status(400).json({ error: "Compila tutti i campi obbligatori." });
    }
    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: "Email non valida." });

    const {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      RESEND_API_KEY,
      CONTACT_TO_EMAIL,
      CONTACT_FROM_EMAIL
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Configurazione Supabase mancante." });
    }
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: "Configurazione Resend mancante." });
    }
    if (!CONTACT_TO_EMAIL || !CONTACT_FROM_EMAIL) {
      return res.status(500).json({ error: "Email di contatto non configurate." });
    }

    // 1) Insert in Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: inserted, error: dbErr } = await supabase
      .from("contact_messages")
      .insert([{
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone || null,
        subject: cleanSubject,
        message: cleanMessage
      }])
      .select("id")
      .single();

    if (dbErr) {
      console.error("[SUPABASE INSERT ERROR]", dbErr);
      return res.status(500).json({ error: "Errore salvataggio del messaggio." });
    }

    // 2) Send email (best-effort)
    const resend = new Resend(RESEND_API_KEY);

    const html = `
      <h2>Nuovo messaggio dal sito Agricola Gentili</h2>
      <p><strong>ID:</strong> ${inserted?.id ?? "-"}</p>
      <p><strong>Nome:</strong> ${cleanName}</p>
      <p><strong>Email:</strong> ${cleanEmail}</p>
      <p><strong>Telefono:</strong> ${cleanPhone || "-"}</p>
      <p><strong>Oggetto:</strong> ${cleanSubject}</p>
      <hr/>
      <p style="white-space:pre-wrap;">${cleanMessage}</p>
    `;

    const send = await resend.emails.send({
      from: CONTACT_FROM_EMAIL,
      to: [CONTACT_TO_EMAIL],
      replyTo: cleanEmail,
      subject: `[Contatti] ${cleanSubject} — ${cleanName}`,
      html
    });

    if (send?.error) {
      console.error("[RESEND ERROR]", send.error);
      return res.status(200).json({ ok: true, id: inserted?.id, warning: "Salvato ma email non inviata." });
    }

    return res.status(200).json({ ok: true, id: inserted?.id });
  } catch (err) {
    console.error("[CONTACT API ERROR]", err);
    return res.status(500).json({ error: "Errore interno." });
  }
};
