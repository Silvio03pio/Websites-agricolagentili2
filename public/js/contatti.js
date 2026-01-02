(() => {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const successBox = document.getElementById("form-success");
  const btn = form.querySelector('button[type="submit"]');
  const btnText = btn?.querySelector(".btn-text");
  const btnLoading = btn?.querySelector(".btn-loading");

  // Honeypot anti-bot
  const hp = document.createElement("input");
  hp.type = "text";
  hp.name = "website";
  hp.autocomplete = "off";
  hp.tabIndex = -1;
  hp.style.position = "absolute";
  hp.style.left = "-9999px";
  hp.style.opacity = "0";
  form.appendChild(hp);

  function setLoading(isLoading) {
    if (!btn) return;
    btn.disabled = isLoading;
    if (btnText && btnLoading) {
      btnText.style.display = isLoading ? "none" : "inline";
      btnLoading.style.display = isLoading ? "inline" : "none";
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      name: form.elements["name"]?.value || "",
      email: form.elements["email"]?.value || "",
      phone: form.elements["phone"]?.value || "",
      subject: form.elements["subject"]?.value || "",
      message: form.elements["message"]?.value || "",
      privacy: form.elements["privacy"]?.checked || false,
      website: hp.value
    };

    try {
      setLoading(true);

      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store"
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      form.style.display = "none";
      if (successBox) successBox.style.display = "block";
      form.reset();
    } catch (err) {
      console.error("[CONTACT FORM ERROR]", err);
      alert(err?.message || "Errore invio. Riprova.");
    } finally {
      setLoading(false);
    }
  });
})();
