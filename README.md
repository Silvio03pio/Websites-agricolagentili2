# Websites-agricolagentili2

# Agricola Gentili — Sito e-commerce (Vino & Olio)

## 1) Obiettivo del progetto
**Agricola Gentili** è un sito web con finalità e-commerce per la vendita di **vino** e **olio** (B2C) e la gestione di un’**Area Rivenditori** (B2B).

### Pagine del sito
- Home
- Storia
- Vini
- Olio
- Negozio
- Area Rivenditori

---

## 2) Stack e servizi
- **GitHub**: versionamento e collaborazione
- **Vercel**: hosting + funzioni serverless `/api/*` + preview deploy
- **Supabase**: database + autenticazione (clienti/rivenditori)
- **Stripe**: checkout e pagamenti
- **Resend**: invio email transazionali (contatti, notifiche)

---

## 3) Funzioni dinamiche principali
### (A) Checkout Stripe (Negozio)
- Carrello lato client
- Endpoint serverless: `POST /api/create-checkout-session`
- Redirect al Checkout Stripe
- (Fase successiva) Webhook Stripe per salvare ordini su DB + email conferma

### (B) Login (Supabase Auth)
- **Rivenditori (B2B)**: login obbligatorio per accesso Area Rivenditori e listino dedicato
- **Clienti (B2C)**: login previsto “al momento dell’acquisto” (o opzionale in fase iniziale)
- Ruoli gestiti via tabella `profiles` (es. `role = 'wholesale' | 'customer'`)

### (C) Modulo contatti (Supabase + Resend)
- Form contatti → `POST /api/contact`
- Salvataggio su tabella `contact_messages`
- Email notifica al team (Resend)
- (Opzionale) autoresponder al cliente

---

## 4) Principi di architettura (regole anti-confusione)
1. **Frontend statico** e **backend serverless** separati chiaramente.
2. **Nessuna chiave segreta nel frontend** (Stripe secret, Resend API key, Supabase service role).
3. Sviluppo locale con **`vercel dev`** (frontend + API stessa origin → niente CORS).
4. Ogni pagina ha **un solo JS** “source of truth” (evitare duplicati e “simulate submission”).
5. Ogni endpoint `/api/*` risponde sempre JSON standard:
   - `200 { ok: true, ... }`
   - `4xx/5xx { error: "..." }`


---

## 6) Environment Variables (Vercel + locale)
### Supabase
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (solo se serve auth lato client)
- `SUPABASE_SERVICE_ROLE_KEY` (solo backend)

### Stripe
- `STRIPE_SECRET_KEY`
- (opzionale) `STRIPE_WEBHOOK_SECRET`

### Resend
- `RESEND_API_KEY`
- `CONTACT_TO_EMAIL`
- `CONTACT_FROM_EMAIL` (mittente verificato su Resend)

> In locale usare `.env.local` (non va committato). Su Vercel impostare le stesse env vars in Settings → Environment Variables.

---

## 7) Setup locale (standard)
### Prerequisiti
- Node.js LTS
- Vercel CLI

### Installazione
```bash
npm install


## 5) Struttura repo consigliata
