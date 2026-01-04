import { getSupabase } from "/js/supabaseClient.js";
import { readCart, updateQty, removeItem } from "/js/cart.js";
import { formatEUR } from "/js/pricing.js";

function qs(sel) { return document.querySelector(sel); }

const POST_LOGIN_CHECKOUT_KEY = "ag_post_login_checkout_v1";

function setStatus(text, isErr = false) {
  const el = qs("#cart-status");
  if (!el) return;
  el.textContent = text;
  el.style.color = isErr ? "crimson" : "inherit";
}

function lineItemRow(p, qty, lineTotalCents) {
  const row = document.createElement("div");
  row.style.border = "1px solid rgba(0,0,0,.12)";
  row.style.borderRadius = "12px";
  row.style.padding = "12px";
  row.style.display = "flex";
  row.style.justifyContent = "space-between";
  row.style.gap = "12px";
  row.style.alignItems = "center";

  row.innerHTML = `
    <div style="min-width: 0;">
      <div><strong>${p.name}</strong></div>
      <div style="opacity:.8;">${String(p.category || "").toUpperCase()} • ${Number(p.volume_liters || 0).toFixed(3)} L</div>
      <div style="opacity:.9; margin-top:6px;">Totale riga: <strong>${formatEUR(lineTotalCents)}</strong></div>
    </div>

    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
      <label>Qtà
        <input type="number" min="0" step="1" value="${qty}" style="width:72px;" data-qty="${p.id}">
      </label>
      <button type="button" data-remove="${p.id}">Rimuovi</button>
    </div>
  `;
  return row;
}

function normalizeCartItems(items) {
  // Somma qty per productId e rimuove qty <= 0
  const map = new Map();
  for (const it of (items || [])) {
    const id = it?.productId;
    const qty = Math.max(0, Math.floor(Number(it?.qty || 0)));
    if (!id || qty <= 0) continue;
    map.set(id, (map.get(id) || 0) + qty);
  }
  return [...map.entries()].map(([productId, qty]) => ({ productId, qty }));
}

async function requireLoginOrRedirect(supabase, nextUrl) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;

  localStorage.setItem(POST_LOGIN_CHECKOUT_KEY, "1");
  location.replace(`/login.html?next=${encodeURIComponent(nextUrl)}`);
  return null;
}

async function startCheckout(supabase) {
  const btn = qs("#btn-checkout");
  if (btn) btn.disabled = true;

  setStatus("Avvio checkout in corso...");

  // Login solo al checkout
  const session = await requireLoginOrRedirect(supabase, "/carrello.html");
  if (!session) return;

  const cart = readCart();
  const items = normalizeCartItems(cart.items);

  if (!items.length) {
    setStatus("Il carrello è vuoto.", true);
    if (btn) btn.disabled = false;
    return;
  }

  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ items })
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok || !payload?.ok || !payload?.url) {
      const msg = payload?.error || `Errore checkout (HTTP ${res.status})`;
      setStatus(msg, true);
      if (btn) btn.disabled = false;
      return;
    }

    location.href = payload.url;
  } catch (e) {
    console.error(e);
    setStatus("Errore di rete durante il checkout.", true);
    if (btn) btn.disabled = false;
  }
}

(async () => {
  const itemsEl = qs("#cart-items");
  const totalEl = qs("#cart-total");
  const btnCheckout = qs("#btn-checkout");

  const supabase = await getSupabase();

  // Carica carrello
  const cart = readCart();
  const items = normalizeCartItems(cart.items);

  if (!items.length) {
    setStatus("Il carrello è vuoto.");
    if (totalEl) totalEl.textContent = "";
    if (btnCheckout) btnCheckout.disabled = true;
    return;
  }

  setStatus("Caricamento carrello...");

  // Carica prodotti dal DB (serve SELECT anon/auth su products)
  const ids = items.map(i => i.productId);

  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, category, volume_liters, price_cents, currency, active")
    .in("id", ids);

  if (error) {
    console.error(error);
    setStatus("Errore caricamento carrello.", true);
    if (btnCheckout) btnCheckout.disabled = true;
    return;
  }

  const map = new Map((products || []).map(p => [p.id, p]));

  function render() {
    if (!itemsEl || !totalEl) return;

    itemsEl.innerHTML = "";
    let total = 0;

    const current = normalizeCartItems(readCart().items);

    for (const item of current) {
      const p = map.get(item.productId);

      if (!p || p.active !== true) {
        const warn = document.createElement("div");
        warn.style.border = "1px solid rgba(0,0,0,.12)";
        warn.style.borderRadius = "12px";
        warn.style.padding = "12px";
        warn.innerHTML = `
          <strong>Prodotto non disponibile</strong>
          <div style="opacity:.8;">Rimuovilo dal carrello per procedere.</div>
        `;
        itemsEl.appendChild(warn);
        continue;
      }

      const unit = Number(p.price_cents || 0);
      const qty = Math.max(0, Math.floor(Number(item.qty || 0)));
      const line = unit * qty;

      total += line;
      itemsEl.appendChild(lineItemRow(p, qty, line));
    }

    totalEl.textContent = `Totale: ${formatEUR(total)}`;

    // checkout solo se totale > 0
    if (btnCheckout) btnCheckout.disabled = total <= 0;

    setStatus("Controlla quantità e procedi al checkout.");

    // bind qty
    itemsEl.querySelectorAll("input[data-qty]").forEach(inp => {
      inp.addEventListener("change", () => {
        const id = inp.getAttribute("data-qty");
        const qty = Math.max(0, parseInt(inp.value || "0", 10));
        updateQty(id, qty);
        render();
      });
    });

    // bind remove
    itemsEl.querySelectorAll("button[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-remove");
        removeItem(id);
        render();
      });
    });
  }

  render();

  // Checkout
  btnCheckout?.addEventListener("click", () => startCheckout(supabase));

  // Auto-checkout post login
  const post = localStorage.getItem(POST_LOGIN_CHECKOUT_KEY);
  if (post === "1") {
    localStorage.removeItem(POST_LOGIN_CHECKOUT_KEY);
    if (!btnCheckout?.disabled) startCheckout(supabase);
  }
})();
