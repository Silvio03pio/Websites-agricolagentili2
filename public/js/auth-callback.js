import { getSupabase } from "/js/supabaseClient.js";

function mountStatus() {
  let el = document.getElementById("status");
  if (!el) {
    const main = document.querySelector("main.container") || document.querySelector("main") || document.body;
    const wrap = document.createElement("div");
    wrap.className = "container";
    wrap.style.marginTop = "24px";

    const h = document.createElement("h1");
    h.textContent = "Accesso in corso...";
    el = document.createElement("p");
    el.id = "status";
    el.textContent = "Sto completando l’accesso.";

    wrap.appendChild(h);
    wrap.appendChild(el);
    main.appendChild(wrap);
  }
  return el;
}

(async () => {
  const statusEl = mountStatus();
  const setStatus = (t) => (statusEl.textContent = t);

  try {
    const supabase = await getSupabase();

    // Errori OAuth possono arrivare nell’hash (#error=...).
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const oauthErr = hashParams.get("error_description") || hashParams.get("error");

    if (oauthErr) {
      setStatus(`Errore accesso: ${oauthErr}`);
      localStorage.removeItem("auth_next");
      setTimeout(() => location.replace("/login.html"), 900);
      return;
    }

    // PKCE: scambio code -> session
    const qs = new URLSearchParams(location.search);
    const code = qs.get("code");

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setStatus(`Errore sessione: ${error.message}`);
        localStorage.removeItem("auth_next");
        setTimeout(() => location.replace("/login.html"), 900);
        return;
      }
    }

    const next = localStorage.getItem("auth_next") || "/";
    localStorage.removeItem("auth_next");
    setStatus("Accesso completato. Reindirizzamento...");
    location.replace(next);
  } catch (e) {
    console.error(e);
    const next = localStorage.getItem("auth_next") || "/";
    localStorage.removeItem("auth_next");
    setStatus("Errore imprevisto durante l’accesso. Reindirizzamento al login...");
    setTimeout(() => location.replace(`/login.html?next=${encodeURIComponent(next)}`), 900);
  }
})();
