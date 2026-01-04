(async () => {
  const mount = document.getElementById("dynamic-header");
  if (!mount) return;

  try {
    const res = await fetch("/partials/header.html", { cache: "no-store" });
    if (!res.ok) throw new Error(`Header load failed (HTTP ${res.status})`);
    mount.innerHTML = await res.text();

    const menu = mount.querySelector("details.menu");
    if (!menu) return;

    const panel = menu.querySelector(".menu__panel");
    const summary = menu.querySelector("summary");

    // Legge --menu-anim-ms dal :root (supporta "320ms" e "0.32s")
    const getAnimMs = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--menu-anim-ms")
        .trim();

      if (!raw) return 320;

      if (raw.endsWith("ms")) {
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : 320;
      }

      if (raw.endsWith("s")) {
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n * 1000 : 320;
      }

      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : 320;
    };

    let closing = false;

    const closeMenuAnimated = () => {
      if (!menu.hasAttribute("open") || closing) return;
      closing = true;

      panel?.classList.add("is-closing");

      window.setTimeout(() => {
        menu.removeAttribute("open");
        panel?.classList.remove("is-closing");
        closing = false;
      }, getAnimMs());
    };

    // Click su summary: se aperto -> chiudi con animazione
    summary?.addEventListener("click", (e) => {
      if (menu.hasAttribute("open")) {
        e.preventDefault();
        closeMenuAnimated();
      }
      // se è chiuso, lasciamo fare al browser l'apertura
    });

    // Click sul backdrop (solo se clicchi il pannello, non il contenuto)
    panel?.addEventListener("click", (e) => {
      if (e.target === panel) closeMenuAnimated();
    });

    // ESC -> chiudi (solo se aperto)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenuAnimated();
    });

    // Click su un link -> chiudi (non blocca la navigazione)
    menu.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => closeMenuAnimated());
    });

  } catch (err) {
    console.error("[HEADER ERROR]", err);
  }
})();
