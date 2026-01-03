import { getSupabase } from "/js/supabaseClient.js";
import { clearCart } from "/js/cart.js";

function qs(sel) { return document.querySelector(sel); }

function formatEUR(cents, currency = "EUR") {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format((cents || 0) / 100);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  const statusEl = qs("#success-status");
  const detailsEl = qs("#success-details");

  const params = new URLSearchParams(location.search);
  const checkoutSessionId = params.get("session_id");

  if (!checkoutSessionId) {
    statusEl.textContent = "Manca il riferimento della sessione di pagamento.";
    statusEl.style.color = "crimson";
    return;
  }

  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    statusEl.textContent = "Accedi per visualizzare il tuo ordine.";
    statusEl.style.color = "crimson";
    return;
  }

  // Poll: il webhook può arrivare qualche secondo dopo il redirect
  for (let attempt = 1; attempt <= 8; attempt++) {
    statusEl.textContent = `Sto verificando l’ordine... (${attempt}/8)`;

    const res = await fetch(`/api/order-status?session_id=${encodeURIComponent(checkoutSessionId)}`, {
      headers: { "Authorization": `Bearer ${session.access_token}` }
    });

    const payload = await res.json().catch(() => ({}));

    if (res.ok && payload?.ok && payload?.order) {
      const o = payload.order;

      if (o.status === "paid" || o.payment_status === "paid") {
        clearCart();
        statusEl.textContent = "Pagamento confermato. Ordine registrato con successo.";
        statusEl.style.color = "inherit";

        detailsEl.innerHTML = `
          <div><strong>Totale:</strong> ${formatEUR(o.amount_total_cents, o.currency)}</div>
          <div style="opacity:.85;"><strong>Stato:</strong> ${o.status}</div>
        `;
        return;
      }

      // ordine presente ma non ancora paid
      detailsEl.innerHTML = `
        <div><strong>Totale:</strong> ${formatEUR(o.amount_total_cents, o.currency)}</div>
        <div style="opacity:.85;"><strong>Stato:</strong> ${o.status} (${o.payment_status || "n/d"})</div>
      `;
    }

    await sleep(1500);
  }

  statusEl.textContent = "Ordine in elaborazione. Se non lo vedi entro pochi minuti, contattaci.";
  statusEl.style.color = "crimson";
})();
