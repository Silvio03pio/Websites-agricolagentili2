(async () => {
  const mount = document.getElementById("dynamic-header");
  if (!mount) return;

  try {
    const res = await fetch("/partials/header.html", { cache: "no-store" });
    if (!res.ok) throw new Error(`Header load failed (HTTP ${res.status})`);
    mount.innerHTML = await res.text();
  } catch (err) {
    console.error("[HEADER ERROR]", err);
  }
})();
