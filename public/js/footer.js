(async () => {
  const mount = document.getElementById("dynamic-footer");
  if (!mount) return;

  try {
    const res = await fetch("/partials/footer.html", { cache: "no-store" });
    if (!res.ok) throw new Error(`Footer load failed (HTTP ${res.status})`);
    mount.innerHTML = await res.text();

    const year = mount.querySelector("#year");
    if (year) year.textContent = String(new Date().getFullYear());
  } catch (err) {
    console.error("[FOOTER ERROR]", err);
  }
})();
