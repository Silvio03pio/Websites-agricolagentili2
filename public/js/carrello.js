import { getSupabase } from "/js/supabaseClient.js";
import { readCart, updateQty, removeItem } from "/js/cart.js";
import { formatEUR, priceForRole, getCurrentUserRole } from "/js/pricing.js";

function qs(sel) { return document.querySelector(sel); }

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

(async () => {
  const statusEl = qs("#cart-status");
  const itemsEl = qs("#cart-items");
  const totalEl = qs("#cart-total");

  const cart = readCart();
  if (!cart.items.length) {
    statusEl.textContent = "Il carrello è vuoto.";
    totalEl.textContent = "";
    return;
  }

  statusEl.textContent = "Caricamento carrello...";
  const supabase = await getSupabase();
  const { role } = await getCurrentUserRole();

  // carica prodotti presenti nel carrello
  const ids = cart.items.map(i => i.productId);

  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, category, volume_liters, price_cents, currency")
    .in("id", ids);

  if (error) {
    console.error(error);
    statusEl.textContent = "Errore caricamento carrello.";
    statusEl.style.color = "crimson";
    return;
  }

  const map = new Map(products.map(p => [p.id, p]));

  function render() {
    itemsEl.innerHTML = "";
    let total = 0;

    for (const item of readCart().items) {
      const p = map.get(item.productId);
      if (!p) continue;

      const unit = priceForRole(p.price_cents, role);
      const line = unit * item.qty;
      total += line;

      itemsEl.appendChild(lineItemRow(p, item.qty, line));
    }

    totalEl.textContent = `Totale: ${formatEUR(total)}`;
    statusEl.textContent = role === "retailer"
      ? "Prezzi rivenditore (-10%) applicati."
      : "Controlla quantità e procedi quando il checkout sarà attivo.";

    // qty change
    itemsEl.querySelectorAll("input[data-qty]").forEach(inp => {
      inp.addEventListener("change", () => {
        const id = inp.getAttribute("data-qty");
        const qty = Math.max(0, parseInt(inp.value || "0", 10));
        updateQty(id, qty);
        render();
      });
    });

    // remove
    itemsEl.querySelectorAll("button[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-remove");
        removeItem(id);
        location.reload();
      });
    });
  }

  render();
})();
