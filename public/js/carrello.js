import { getSupabase } from "/js/supabaseClient.js";
import { formatEUR, priceForRole, getCurrentUserRole } from "/js/pricing.js";

// ============ CONFIG STORAGE ============
const CART_KEY = "ag_cart_v1";

// ============ HELPERS ============
function qs(sel, root = document) { return root.querySelector(sel); }

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items || []));
}

function setQty(productId, qty) {
  const cart = readCart();
  const q = Math.max(0, Math.min(99, Math.floor(Number(qty || 0))));
  const idx = cart.findIndex(i => i.productId === productId);

  if (q <= 0) {
    if (idx >= 0) cart.splice(idx, 1);
  } else {
    if (idx >= 0) cart[idx].qty = q;
    else cart.push({ productId, qty: q });
  }

  writeCart(cart);
  return cart;
}

function clearCart() {
  writeCart([]);
}

async function fetchJson(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

// ============ UI ============
function setText(el, txt, isError = false) {
  if (!el) return;
  el.textContent = txt || "";
  el.style.color = isError ? "crimson" : "";
}

function setVisible(el, visible) {
  if (!el) return;
  el.style.display = visible ? "" : "none";
}

function moneyLine(cents) {
  return formatEUR(cents);
}

// ============ MAIN ============
(async () => {
  const statusEl = qs("#cart-status");
  const itemsEl = qs("#cart-items");
  const totalEl = qs("#cart-total");

  const authStatusEl = qs("#auth-status");
  const authActionsEl = qs("#auth-actions");
  const authLoggedEl = qs("#auth-logged");
  const authEmailEl = qs("#auth-email");
  const authWarningEl = qs("#auth-warning");

  const checkoutAuthEl = qs("#checkout-auth");
  const checkoutGuestEl = qs("#checkout-guest");
  const btnAuth = qs("#btn-checkout-auth");
  const btnGuest = qs("#btn-checkout-guest");
  const guestEmailInput = qs("#guest-email");
  const guestHint = qs("#guest-hint");

  const supabase = await getSupabase();

  // ruolo per prezzi (retailer => -10%) — lato UI
  const { role } = await getCurrentUserRole();
  const isRetailer = role === "retailer";

  // carrello locale
  let cart = readCart();
  if (!cart.length) {
    setText(statusEl, "Il carrello è vuoto.");
    if (itemsEl) itemsEl.innerHTML = "";
    if (totalEl) totalEl.textContent = "";
    if (btnAuth) btnAuth.disabled = true;
    if (btnGuest) btnGuest.disabled = true;
    setText(authStatusEl, "Nessun prodotto nel carrello.");
    setVisible(checkoutAuthEl, false);
    setVisible(checkoutGuestEl, false);
    return;
  }

  // session / auth state
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user || null;

  // email confermata: in Supabase può chiamarsi confirmed_at o email_confirmed_at
  const emailConfirmedAt = user?.email_confirmed_at || user?.confirmed_at || null;
  const isEmailConfirmed = Boolean(emailConfirmedAt);

  // UI auth panel
  if (!user) {
    setText(authStatusEl, "Non sei loggato.");
    setVisible(authActionsEl, true);
    setVisible(authLoggedEl, false);
  } else {
    setText(authStatusEl, "Sei loggato.");
    setVisible(authActionsEl, false);
    setVisible(authLoggedEl, true);
    if (authEmailEl) authEmailEl.textContent = user.email || "-";

    if (!isEmailConfirmed) {
      setVisible(authWarningEl, true);
      setText(authWarningEl, "Email non confermata: puoi confermare via link ricevuto, oppure procedere come ospite.");
    } else {
      setVisible(authWarningEl, false);
      setText(authWarningEl, "");
    }
  }

  // Carica prodotti da Supabase
  const ids = [...new Set(cart.map(i => i.productId))];

  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("id, name, price_cents, currency, active")
    .in("id", ids);

  if (prodErr) {
    console.error(prodErr);
    setText(statusEl, "Errore nel caricamento prodotti del carrello.", true);
    if (btnAuth) btnAuth.disabled = true;
    if (btnGuest) btnGuest.disabled = true;
    setVisible(checkoutAuthEl, false);
    setVisible(checkoutGuestEl, false);
    return;
  }

  const map = new Map((products || []).map(p => [p.id, p]));

  // filtra prodotti non più acquistabili
  cart = cart.filter(i => {
    const p = map.get(i.productId);
    return p && p.active === true;
  });

  if (!cart.length) {
    clearCart();
    setText(statusEl, "Il carrello è vuoto.");
    if (itemsEl) itemsEl.innerHTML = "";
    if (totalEl) totalEl.textContent = "";
    if (btnAuth) btnAuth.disabled = true;
    if (btnGuest) btnGuest.disabled = true;
    setVisible(checkoutAuthEl, false);
    setVisible(checkoutGuestEl, false);
    return;
  }

  function computeTotal() {
    let total = 0;
    for (const row of cart) {
      const p = map.get(row.productId);
      if (!p) continue;
      const unit = priceForRole(p.price_cents, role);
      total += unit * row.qty;
    }
    return total;
  }

  function renderCart() {
    if (!itemsEl) return;

    itemsEl.innerHTML = "";
    let total = 0;

    for (const row of cart) {
      const p = map.get(row.productId);
      if (!p) continue;

      const unit = priceForRole(p.price_cents, role);
      const line = unit * row.qty;
      total += line;

      const item = document.createElement("div");
      item.style.border = "1px solid rgba(0,0,0,.12)";
      item.style.borderRadius = "12px";
      item.style.padding = "12px";
      item.style.display = "flex";
      item.style.gap = "12px";
      item.style.alignItems = "center";
      item.style.justifyContent = "space-between";

      item.innerHTML = `
        <div style="min-width:0;">
          <div style="font-weight:700;">${p.name}</div>
          <div style="opacity:.8; font-size:13px;">${isRetailer ? "Prezzo rivenditore (-10%)" : "Prezzo cliente"}</div>
          <div style="margin-top:6px;"><strong>${moneyLine(unit)}</strong> <span style="opacity:.8;">/ cad.</span></div>
        </div>

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
          <label style="display:flex; align-items:center; gap:6px;">
            Qtà
            <input type="number" min="1" max="99" value="${row.qty}" data-qty="${p.id}" style="width:72px;">
          </label>

          <div style="min-width:110px; text-align:right;">
            <div style="opacity:.75; font-size:12px;">Totale riga</div>
            <div style="font-weight:700;">${moneyLine(line)}</div>
          </div>

          <button type="button" data-remove="${p.id}">Rimuovi</button>
        </div>
      `;

      itemsEl.appendChild(item);
    }

    setText(statusEl, "Controlla quantità e procedi al checkout.");
    if (totalEl) totalEl.textContent = `Totale: ${moneyLine(total)}`;

    // bind qty
    itemsEl.querySelectorAll("input[data-qty]").forEach(inp => {
      inp.addEventListener("change", () => {
        const id = inp.getAttribute("data-qty");
        const val = Number(inp.value || 1);
        cart = setQty(id, val);
        renderCart();
        updateCheckoutButtons();
      });
    });

    // bind remove
    itemsEl.querySelectorAll("button[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-remove");
        cart = setQty(id, 0);

        if (!cart.length) {
          clearCart();
          setText(statusEl, "Il carrello è vuoto.");
          if (itemsEl) itemsEl.innerHTML = "";
          if (totalEl) totalEl.textContent = "";
          if (btnAuth) btnAuth.disabled = true;
          if (btnGuest) btnGuest.disabled = true;
          setVisible(checkoutAuthEl, false);
          setVisible(checkoutGuestEl, false);
          return;
        }

        renderCart();
        updateCheckoutButtons();
      });
    });
  }

  function updateCheckoutButtons() {
    const total = computeTotal();
    const hasItems = cart.length > 0 && total > 0;

    // Se loggato: mostra blocco auth (ma se email non confermata, comunque lasciamo anche guest)
    if (user) {
      setVisible(checkoutAuthEl, true);
      if (btnAuth) btnAuth.disabled = !hasItems;

      // Guest sempre disponibile (utile come fallback)
      setVisible(checkoutGuestEl, true);
    } else {
      setVisible(checkoutAuthEl, false);
      setVisible(checkoutGuestEl, true);
    }

    // Guest button abilitato solo se email valida + carrello non vuoto
    const guestOk = isValidEmail(guestEmailInput?.value || "");
    if (btnGuest) btnGuest.disabled = !(hasItems && guestOk);

    if (guestHint) {
      if (!hasItems) guestHint.textContent = "";
      else guestHint.textContent = guestOk ? "Riceverai la conferma a questa email." : "Inserisci un’email valida per procedere.";
    }
  }

  renderCart();

  // guest email input binding
  guestEmailInput?.addEventListener("input", updateCheckoutButtons);
  updateCheckoutButtons();

  function buildItemsPayload() {
    return cart.map(i => ({ productId: i.productId, qty: i.qty }));
  }

  async function goCheckoutAsGuest(email) {
    const payload = { items: buildItemsPayload(), guest_email: String(email || "").trim() };
    const { res, json } = await fetchJson("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !json.ok || !json.url) {
      console.error(json);
      throw new Error(json?.error || `Errore checkout (HTTP ${res.status})`);
    }
    location.href = json.url;
  }

  async function goCheckoutAsAuth() {
    const { data: { session: s } } = await supabase.auth.getSession();
    const token = s?.access_token;

    if (!token) {
      // se per qualche motivo perde sessione, fallback guest
      throw new Error("Sessione scaduta. Procedi come ospite o effettua di nuovo l’accesso.");
    }

    const payload = { items: buildItemsPayload() };

    const { res, json } = await fetchJson("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload),
    });

    // Se backend blocca per email non confermata (o altro), fallback guest
    if (res.status === 403) {
      const email = guestEmailInput?.value || "";
      const canGuest = isValidEmail(email);
      if (!canGuest) {
        throw new Error(json?.error || "Accesso non consentito. Inserisci un’email valida per procedere come ospite.");
      }
      await goCheckoutAsGuest(email);
      return;
    }

    if (!res.ok || !json.ok || !json.url) {
      console.error(json);
      throw new Error(json?.error || `Errore checkout (HTTP ${res.status})`);
    }

    location.href = json.url;
  }

  // click handlers
  btnGuest?.addEventListener("click", async () => {
    try {
      btnGuest.disabled = true;
      if (btnAuth) btnAuth.disabled = true;

      setText(statusEl, "Creazione checkout in corso...");

      const email = guestEmailInput?.value || "";
      if (!isValidEmail(email)) {
        setText(statusEl, "Inserisci un’email valida.", true);
        updateCheckoutButtons();
        return;
      }

      await goCheckoutAsGuest(email);
    } catch (e) {
      console.error(e);
      setText(statusEl, e?.message || "Errore di rete durante il checkout.", true);
      updateCheckoutButtons();
    }
  });

  btnAuth?.addEventListener("click", async () => {
    try {
      btnAuth.disabled = true;
      if (btnGuest) btnGuest.disabled = true;

      setText(statusEl, "Creazione checkout in corso...");

      // se email non confermata, suggeriamo ma non blocchiamo (lasciamo che sia il backend a decidere)
      if (user && !isEmailConfirmed) {
        // Se vuoi bloccare client-side, puoi farlo; io preferisco non bloccare e gestire fallback.
      }

      await goCheckoutAsAuth();
    } catch (e) {
      console.error(e);
      setText(statusEl, e?.message || "Errore di rete durante il checkout.", true);
      updateCheckoutButtons();
    }
  });
})();
