import { getSupabase } from "/js/supabaseClient.js";
import { readCart, updateQty, removeItem } from "/js/cart.js";
import { formatEUR, priceForRole, getCurrentUserRole } from "/js/pricing.js";

function qs(sel) { return document.querySelector(sel); }

const POST_LOGIN_CHECKOUT_KEY = "ag_post_login_checkout_v1";

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
      <div style="opacity:.8;">${p.category.toUpperCase()} • ${Number(p.volume_liters).toFixed(3)} L</div>
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

async function startCheckout(supabase) {
  const statusEl = qs("#cart-status");
  const btn = qs("#btn-checkout");
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "Avvio checkout in corso...";

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    // Non loggato: salva intento checkout e vai al login
    localStorage.setItem(POST_LOGIN_CHECKOUT_KEY, "1");
    location.replace(`/login.html?next=${encodeURIComponent("/carrello.html")}`);
    return;
  }

  const cart = readCart();
  if (!cart.items.length) {
    if (statusEl) statusEl.textContent = "Il carrello è vuoto.";
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
      body: JSON.stringify({ items: cart.items })
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok || !payload?.ok || !payload?.url) {
      const msg = payload?.error || `Errore checkout (HTTP ${res.status})`;
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.style.color = "crimson";
      }
      if (btn) btn.disabled = false;
      return;
    }

    // Redirect a Stripe Checkout
    location.href = payload.url;
  } catch (e) {
    console.error(e);
    if (statusEl) {
      statusEl.textContent = "Errore di rete durante il checkout.";
      statusEl.style.color = "crimson";
    }
    if (btn) btn.disabled = false;
  }
}

(async () => {
  const statusEl = qs("#cart-status");
  const itemsEl = qs("#cart-items");
  const totalEl = qs("#cart-total");
  const btnCheckout = qs("#btn-checkout");

  const cart = readCart();
  if (!cart.items.length) {
    if (statusEl) statusEl.textContent = "Il carrello è vuoto.";
    if (totalEl) totalEl.textContent = "";
    if (btnCheckout) btnCheckout.disabled = true;
    return;
  }

  if (statusEl) statusEl.textContent = "Caricamento carrello...";

  const supabase = await getSupabase();
  const { role } = await getCurrentUserRole();

  const ids = cart.items.map(i => i.productId);

  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, category, volume_liters, price_cents, currency, active")
    .in("id", ids);

  if (error) {
    console.error(error);
    if (statusEl) {
      statusEl.textContent = "Errore caricamento carrello.";
      statusEl.style.color = "crimson";
    }
    if (btnCheckout) btnCheckout.disabled = true;
    return;
  }

  const map = new Map((products || []).map(p => [p.id, p]));

  function render() {
    if (!itemsEl || !totalEl) return;

    itemsEl.innerHTML = "";
    let total = 0;

    const current = readCart().items;

    for (const item of current) {
      const p = map.get(item.productId);

      // prodotto mancante o non attivo: lo segnaliamo e lo escludiamo dal totale
      if (!p || p.active !== true) {
        const warn = document.createElement("div");
        warn.style.border = "1px solid rgba(0,0,0,.12)";
        warn.style.borderRadius = "12px";
        warn.style.padding = "12px";
        warn.innerHTML = `<strong>Prodotto non disponibile</strong><div style="opacity:.8;">Rimuovilo dal carrello per procedere.</div>`;
        itemsEl.appendChild(warn);
        continue;
      }

      const unit = priceForRole(p.price_cents, role);
      const line = unit * item.qty;
      total += line;

      itemsEl.appendChild(lineItemRow(p, item.qty, line));
    }

    totalEl.textContent = `Totale: ${formatEUR(total)}`;
    if (statusEl) {
      statusEl.textContent = role === "retailer"
        ? "Prezzi rivenditore (-10%) applicati."
        : "Controlla quantità e procedi al checkout.";
      statusEl.style.color = "inherit";
    }

    // Enable checkout solo se totale > 0
    if (btnCheckout) btnCheckout.disabled = total <= 0;

    itemsEl.querySelectorAll("input[data-qty]").forEach(inp => {
      inp.addEventListener("change", () => {
        const id = inp.getAttribute("data-qty");
        const qty = Math.max(0, parseInt(inp.value || "0", 10));
        updateQty(id, qty);
        render();
      });
    });

    itemsEl.querySelectorAll("button[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-remove");
        removeItem(id);
        location.reload();
      });
    });
  }

  render();

  // click checkout
  btnCheckout?.addEventListener("click", () => startCheckout(supabase));

  // se l'utente è tornato dal login e aveva chiesto checkout, riparti automaticamente
  const post = localStorage.getItem(POST_LOGIN_CHECKOUT_KEY);
  if (post === "1") {
    localStorage.removeItem(POST_LOGIN_CHECKOUT_KEY);
    // avvio automatico checkout (solo se il bottone non è disabilitato)
    if (!btnCheckout?.disabled) startCheckout(supabase);
  }
})();
