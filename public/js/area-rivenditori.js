import { getSupabase } from "/js/supabaseClient.js";

function qs(sel, root = document) { return root.querySelector(sel); }
function show(el, yes) { if (el) el.style.display = yes ? "" : "none"; }
function setText(el, t, color = "") { if (el) { el.textContent = t || ""; el.style.color = color || ""; } }

function setFormEnabled(form, enabled) {
  if (!form) return;
  [...form.querySelectorAll("input, select, textarea, button")].forEach(el => {
    el.disabled = !enabled;
  });
}

function normalizeVat(vat) {
  const v = String(vat || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^(?:[A-Z]{2})?[A-Z0-9]{8,20}$/.test(v)) return null;
  return v;
}

function normalizeCountryISO2(v) {
  const c = String(v || "").trim().toUpperCase();
  if (!c) return "";
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return c;
}

function formToObject(form) {
  const fd = new FormData(form);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = String(v ?? "").trim();
  return obj;
}

async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

(async () => {
  const supabase = await getSupabase();

  const statusEl = qs("#ar-status");
  const secWholesale = qs("#ar-wholesale");
  const secApply = qs("#ar-apply");

  const form = qs("#retailer-form");
  const feedbackEl = qs("#retailer-feedback");
  const loadingEl = qs("#retailer-loading");
  const btnSubmit = qs("#retailer-submit");

  show(secWholesale, false);
  show(secApply, false);
  show(loadingEl, false);
  setText(statusEl, "Verifica accesso in corso...");
  setText(feedbackEl, "");

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace(`/login.html?next=${encodeURIComponent("/area-rivenditori.html")}`);
    return;
  }

  const userId = session.user.id;

  // role
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr) {
    console.error(profileErr);
    setText(statusEl, "Errore recupero profilo. Verifica trigger/RLS.", "crimson");
    show(secApply, true);
    setFormEnabled(form, false);
    return;
  }

  const role = profile?.role || "customer";

  if (role === "retailer" || role === "admin") {
    setText(statusEl, "Accesso Rivenditori attivo.");
    show(secWholesale, true);
    show(secApply, false);
    return;
  }

  // application status
  show(secWholesale, false);
  show(secApply, true);

  const { data: app, error: appErr } = await supabase
    .from("retailer_applications")
    .select("status, notes, company_name, vat_number")
    .eq("user_id", userId)
    .maybeSingle();

  if (appErr) {
    console.error(appErr);
    setText(statusEl, "Errore nel recupero della richiesta rivenditore.", "crimson");
    setFormEnabled(form, true);
  } else if (!app) {
    setText(statusEl, "Accesso non abilitato: invia una richiesta.");
    setFormEnabled(form, true);
  } else {
    if (app.status === "pending") {
      setText(statusEl, `Richiesta PENDING: ${app.company_name} — ${app.vat_number}`);
      setText(feedbackEl, "Richiesta in verifica. Non puoi reinviare finché è PENDING.");
      setFormEnabled(form, false);
      return;
    }

    if (app.status === "rejected") {
      const note = app.notes ? ` Motivo: ${app.notes}` : "";
      setText(statusEl, `Richiesta rifiutata.${note} Puoi correggere e reinviare.`, "crimson");
      setFormEnabled(form, true);
    }

    if (app.status === "approved") {
      setText(statusEl, "Richiesta approvata. Ricarica (o logout/login) per attivare accesso.", "green");
      setFormEnabled(form, false);
      return;
    }
  }

  // submit -> serverless API
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    setText(feedbackEl, "");
    show(loadingEl, true);
    if (btnSubmit) btnSubmit.disabled = true;

    const payload = formToObject(form);

    if (!payload.company_name) {
      setText(feedbackEl, "Inserisci la ragione sociale.", "crimson");
      show(loadingEl, false);
      if (btnSubmit) btnSubmit.disabled = false;
      return;
    }

    const vat = normalizeVat(payload.vat_number);
    if (!vat) {
      setText(feedbackEl, "VAT non valida (8–20 alfanumerici, prefisso paese opzionale).", "crimson");
      show(loadingEl, false);
      if (btnSubmit) btnSubmit.disabled = false;
      return;
    }
    payload.vat_number = vat;

    const country = normalizeCountryISO2(payload.billing_country || "IT");
    if (payload.billing_country && !country) {
      setText(feedbackEl, "Paese non valido: usa ISO2 (es. IT, DE, FR).", "crimson");
      show(loadingEl, false);
      if (btnSubmit) btnSubmit.disabled = false;
      return;
    }
    if (country) payload.billing_country = country;

    try {
      const { res, json } = await fetchJson("/api/retailer-apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok || !json.ok) {
        setText(feedbackEl, json?.error || `Errore (HTTP ${res.status})`, "crimson");
        console.error(json);
        return;
      }

      if (json.status === "approved") {
        setText(feedbackEl, "Approvato: puoi entrare nell’Area Rivenditori. Controlla l’email.", "green");
        setTimeout(() => location.reload(), 700);
        return;
      }

      if (json.status === "pending") {
        setText(feedbackEl, "Richiesta in verifica (PENDING). Non puoi reinviare finché è pending.");
        setFormEnabled(form, false);
        setTimeout(() => location.reload(), 700);
        return;
      }

      if (json.status === "rejected") {
        setText(feedbackEl, `Richiesta rifiutata: ${json.reason || "verifica VAT non superata"}`, "crimson");
        setFormEnabled(form, true);
        return;
      }

      setText(feedbackEl, "Richiesta inviata.");
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      console.error(err);
      setText(feedbackEl, "Errore di rete.", "crimson");
    } finally {
      show(loadingEl, false);
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });
})();
