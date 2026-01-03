import { getSupabase } from "/js/supabaseClient.js";

function getNext() {
  return new URLSearchParams(location.search).get("next") || "/";
}

function qs(sel, root = document) {
  return root.querySelector(sel);
}

function mountLoginUI() {
  const main = document.querySelector("main.container") || document.querySelector("main") || document.body;

  // Se esiste già una UI (per esempio hai già inserito i form), non ricreare.
  if (qs("#form-login") && qs("#form-signup")) return;

  // Costruisci UI minimale.
  main.innerHTML = `
    <h1>Account</h1>
    <p id="hint-next" style="opacity:.85;"></p>

    <div style="max-width:520px;">
      <div style="display:flex; gap:8px; margin:16px 0;">
        <button id="tab-login" type="button">Accedi</button>
        <button id="tab-signup" type="button">Registrati</button>
      </div>

      <div style="display:flex; gap:8px; margin:12px 0;">
        <button id="btn-google" type="button">Continua con Google</button>
        <button id="btn-apple" type="button">Continua con Apple</button>
      </div>

      <div id="msg" style="margin:12px 0;"></div>

      <form id="form-login" style="margin-top:14px;">
        <label>Email<br><input id="login-email" type="email" required></label><br><br>
        <label>Password<br><input id="login-password" type="password" required></label><br><br>
        <button type="submit">Accedi</button>
      </form>

      <form id="form-signup" style="margin-top:14px; display:none;">
        <label>Nome e Cognome<br><input id="signup-fullname" type="text"></label><br><br>
        <label>Telefono<br><input id="signup-phone" type="text"></label><br><br>
        <label>Email<br><input id="signup-email" type="email" required></label><br><br>
        <label>Password<br><input id="signup-password" type="password" required></label><br><br>
        <button type="submit">Crea account</button>
      </form>
    </div>
  `;
}

(async () => {
  mountLoginUI();

  const next = getNext();
  const msgEl = qs("#msg");
  const hintNext = qs("#hint-next");

  const setMsg = (t, isError = false) => {
    if (!msgEl) return;
    msgEl.textContent = t || "";
    msgEl.style.color = isError ? "crimson" : "inherit";
  };

  if (hintNext) hintNext.textContent = `Dopo l’accesso verrai reindirizzato a: ${next}`;

  const supabase = await getSupabase();

  // Se già loggato, vai al next
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    location.replace(next);
    return;
  }

  const showLogin = () => {
    qs("#form-login")?.style && (qs("#form-login").style.display = "");
    qs("#form-signup")?.style && (qs("#form-signup").style.display = "none");
    setMsg("");
  };

  const showSignup = () => {
    qs("#form-login")?.style && (qs("#form-login").style.display = "none");
    qs("#form-signup")?.style && (qs("#form-signup").style.display = "");
    setMsg("");
  };

  qs("#tab-login")?.addEventListener("click", showLogin);
  qs("#tab-signup")?.addEventListener("click", showSignup);

  // LOGIN email/password
  qs("#form-login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("Accesso in corso...");

    const email = (qs("#login-email")?.value || "").trim();
    const password = qs("#login-password")?.value || "";

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMsg(error.message, true);
      return;
    }
    location.replace(next);
  });

  // SIGNUP email/password
  qs("#form-signup")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("Creazione account in corso...");

    const email = (qs("#signup-email")?.value || "").trim();
    const password = qs("#signup-password")?.value || "";
    const full_name = (qs("#signup-fullname")?.value || "").trim();
    const phone = (qs("#signup-phone")?.value || "").trim();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name, phone } }
    });

    if (error) {
      setMsg(error.message, true);
      return;
    }

    // Se email confirmation è attiva, session può essere null
    if (!data.session) {
      setMsg("Account creato. Controlla l’email per confermare e poi accedi.");
      showLogin();
      return;
    }

    location.replace(next);
  });

  // OAuth (Google/Apple): memorizzo next e uso callback fissa (allowlist semplice)
  function rememberNext() {
    localStorage.setItem("auth_next", next);
  }

  qs("#btn-google")?.addEventListener("click", async () => {
    rememberNext();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback.html` }
    });
    if (error) setMsg(error.message, true);
  });

  qs("#btn-apple")?.addEventListener("click", async () => {
    rememberNext();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: `${location.origin}/auth/callback.html` }
    });
    if (error) setMsg(error.message, true);
  });
})();
