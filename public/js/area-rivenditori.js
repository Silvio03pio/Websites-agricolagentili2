import { getSupabase } from "/js/supabaseClient.js";

function qs(sel, root = document) {
  return root.querySelector(sel);
}

function mountRetailerUI() {
  const main = document.querySelector("main.container") || document.querySelector("main") || document.body;

  // Se hai già inserito una UI dedicata (sezioni/ids), non ricreare.
  if (qs("#retailer-content") || qs("#apply-content") || qs("#application-status")) return;

  // UI minimale generata
  main.innerHTML = `
    <h1>Area Rivenditori</h1>

    <p id="status" style="opacity:.85;">Verifica accesso in corso...</p>

    <section id="retailer-content" style="display:none; margin-top:18px;">
      <p>Benvenuto nell’Area Rivenditori.</p>
      <p>Qui inseriremo il listino dedicato e le condizioni B2B.</p>
      <button id="btn-logout" type="button">Esci</button>
    </section>

    <section id="apply-content" style="display:none; margin-top:18px;">
      <h2>Richiedi accesso rivenditori</h2>
      <p>Compila i dati aziendali. La richiesta verrà valutata dal team.</p>

      <form id="apply-form" style="max-width:520px; margin-top:12px;">
        <label>Ragione sociale<br>
          <input id="company_name" type="text" required>
        </label><br><br>

        <label>Partita IVA<br>
          <input id="vat_number" type="text" required>
        </label><br><br>

        <button type="submit">Invia richiesta</button>
      </form>

      <div style="margin-top:12px;">
        <button id="btn-logout-2" type="button">Esci</button>
      </div>
    </section>

    <section id="application-status" style="display:none; margin-top:18px;">
      <h2>Stato richiesta</h2>
      <p id="application-text"></p>
      <div style="margin-top:12px;">
        <button id="btn-logout-3" type="button">Esci</button>
      </div>
    </section>
  `;
}

function showOnly(sectionId) {
  const ids = ["#retailer-content", "#apply-content", "#application-status"];
  for (const id of ids) {
    const el = qs(id);
    if (!el) continue;
    el.style.display = (id === sectionId) ? "" : "none";
  }
}

(async () => {
  mountRetailerUI();

  const statusEl = qs("#status");
  const setStatus = (t, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = t;
    statusEl.style.color = isError ? "crimson" : "inherit";
  };

  const supabase = await getSupabase();

  // 1) Session check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace(`/login.html?next=${encodeURIComponent("/area-rivenditori.html")}`);
    return;
  }

  // Logout handlers
  const logout = async () => {
    await supabase.auth.signOut();
    location.replace("/");
  };
  qs("#btn-logout")?.addEventListener("click", logout);
  qs("#btn-logout-2")?.addEventListener("click", logout);
  qs("#btn-logout-3")?.addEventListener("click", logout);

  const userId = session.user.id;

  // 2) Leggi ruolo da profiles
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (profileErr) {
    console.error(profileErr);
    setStatus("Errore nel recupero del profilo (profiles). Verifica trigger/RLS.", true);
    // Fallback: consenti comunque richiesta
    setStatus("Accesso non ancora abilitato: invia una richiesta.");
    showOnly("#apply-content");
    return;
  }

  // 3) Se retailer o admin: ok
  if (profile?.role === "retailer" || profile?.role === "admin") {
    setStatus("Accesso autorizzato.");
    showOnly("#retailer-content");
    return;
  }

  // 4) Non retailer: verifica se c'è già una richiesta
  const { data: existingApp, error: appErr } = await supabase
    .from("retailer_applications")
    .select("status, company_name, vat_number, notes")
    .eq("user_id", userId)
    .maybeSingle();

  if (appErr) {
    console.error(appErr);
    setStatus("Errore nel recupero della richiesta rivenditore.", true);
    showOnly("#apply-content");
    return;
  }

  if (!existingApp) {
    setStatus("Accesso non ancora abilitato: invia una richiesta.");
    showOnly("#apply-content");
  } else {
    setStatus("Accesso non ancora abilitato.");
    let text = `La tua richiesta risulta: ${existingApp.status}.`;
    if (existingApp.status === "pending") {
      text += " È in valutazione.";
    } else if (existingApp.status === "rejected") {
      text += " È stata rifiutata.";
      if (existingApp.notes) text += ` Motivo: ${existingApp.notes}`;
    } else if (existingApp.status === "approved") {
      text += " È approvata: ricarica la pagina (o fai logout/login) per aggiornare l’accesso.";
    }
    qs("#application-text") && (qs("#application-text").textContent = text);
    showOnly("#application-status");
  }

  // 5) Submit richiesta
  qs("#apply-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const company_name = (qs("#company_name")?.value || "").trim();
    const vat_number = (qs("#vat_number")?.value || "").trim();

    if (!company_name || !vat_number) {
      setStatus("Compila tutti i campi richiesti.", true);
      return;
    }

    setStatus("Invio richiesta in corso...");

    const { error } = await supabase
      .from("retailer_applications")
      .insert([{ user_id: userId, company_name, vat_number }]);

    if (error) {
      console.error(error);
      setStatus(error.message, true);
      return;
    }

    setStatus("Richiesta inviata. Verrà valutata dal team.");
    location.reload();
  });
})();
