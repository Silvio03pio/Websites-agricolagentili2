import { getSupabase } from "/js/supabaseClient.js";
import { addToCart } from "/js/cart.js";
import { formatEUR } from "/js/pricing.js";

function qs(sel) { return document.querySelector(sel); }

function productCard(p) {
  const wrap = document.createElement("article");
  wrap.style.border = "1px solid rgba(0,0,0,.12)";
  wrap.style.borderRadius = "12px";
  wrap.style.padding = "12px";

  wrap.innerHTML = `
    <div style="aspect-ratio: 4 / 3; background: rgba(0,0,0,.04); border-radius:10px; overflow:hidden; display:flex; align-items:center; justify-content:center;">
      ${p.image_url
        ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%; height:100%; object-fit:cover;">`
        : `<span style="opacity:.7;">Immagine</span>`
      }
    </div>

    <h3 style="margin:10px 0 6px;">${p.name}</h3>
    <div style="opacity:.85;">${String(p.category || "").toUpperCase()} • ${Number(p.volume_liters || 0).toFixed(3)} L</div>
    <p style="opacity:.85; margin:8px 0;">${p.description || ""}</p>

    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:10px;">
      <strong>${formatEUR(Number(p.price_cents || 0))}</strong>
      <button type="button" data-add="${p.id}">Aggiungi</button>
    </div>
  `;
  return wrap;
}

(async () => {
  const statusEl = qs("#shop-status");
  const grid = qs("#product-grid");
  const filter = qs("#filter-category");

  const supabase = await getSupabase();

  const { data: products, error } = await supabase
    .from("products")
    .select("id, slug, name, category, volume_liters, description, image_url, price_cents, currency, sort_order, active")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error(error);
    if (statusEl) {
      statusEl.textContent = "Errore caricamento prodotti.";
      statusEl.style.color = "crimson";
    }
    return;
  }

  if (statusEl) {
    statusEl.textContent = "Seleziona i prodotti e aggiungili al carrello.";
    statusEl.style.color = "inherit";
  }

  function render() {
    const cat = filter?.value || "all";
    if (grid) grid.innerHTML = "";

    const list = (products || []).filter(p => (cat === "all" ? true : p.category === cat));
    for (const p of list) grid?.appendChild(productCard(p));

    grid?.querySelectorAll("button[data-add]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-add");
        addToCart(id, 1);
        btn.textContent = "Aggiunto";
        setTimeout(() => (btn.textContent = "Aggiungi"), 700);
      });
    });
  }

  filter?.addEventListener("change", render);
  render();
})();
