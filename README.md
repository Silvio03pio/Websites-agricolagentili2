# Websites-agricolagentili2 — Agricola Gentili (Orvieto)
Sito e-commerce per **Vino & Olio** con:
- vendita **B2C** (clienti privati)
- **Area Rivenditori (B2B)** con registrazione/login e prezzi dedicati
- checkout e pagamenti con Stripe
- ordini salvati su Supabase (Postgres) tramite webhook
- modulo contatti salvato su DB e notificato via email (Resend)

Dominio: **agricolagentiliorvieto.com** (con gestione `www` coerente per Stripe Webhooks)

---

## 1) Obiettivo del progetto
Realizzare un sito moderno e manutenibile, con frontend statico e funzionalità dinamiche server-side tramite API serverless.

**Pilastri**
- Separazione netta: **frontend statico** + **backend serverless** (`/api/*`)
- Sicurezza: nessuna chiave segreta nel frontend
- Fonte di verità: prezzi e catalogo sul DB (Supabase)
- Checkout affidabile: ordini confermati via **Stripe Webhook**, non via sola pagina “success”

---

## 2) Stack e servizi
- **GitHub**: versionamento e collaborazione
- **Vercel**: hosting + Serverless Functions (`/api/*`) + deploy automatici
- **Supabase**:
  - Auth (utenti B2C e B2B nello stesso bacino)
  - Database Postgres
  - RLS (Row Level Security) per protezione dati
- **Stripe**: Checkout e pagamenti (Test mode attivo durante sviluppo)
- **Resend**: email transazionali (notifiche contatti e possibili email ordine)

---

## 3) Architettura e principi (anti-confusione)
### 3.1 Frontend vs Backend
- Frontend: HTML/CSS/JS statico in `/public`
- Backend: endpoint serverless in `/api`

### 3.2 Segreti
Mai nel frontend:
- Stripe Secret Key
- Stripe Webhook Secret
- Resend API Key
- Supabase Service Role Key

Nel frontend sono ammessi solo:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (pubblica per definizione; la sicurezza è garantita da RLS)

### 3.3 Standard risposta JSON per API
Tutti gli endpoint /api rispondono in modo consistente:
- `200 { ok: true, ... }`
- `4xx/5xx { ok: false, error: "...", details?: "..." }`

### 3.4 Sviluppo locale
Sviluppo consigliato con:
- `vercel dev` (frontend e API sulla stessa origin → no CORS)

---

## 4) Funzioni implementate (stato attuale)

### 4.1 Modulo contatti (Supabase + Resend)
**Obiettivo**: salvare ogni richiesta su DB e notificare il team via email.

**Flow**
1) Form contatti → `POST /api/contact`
2) Salvataggio su tabella Supabase: `contact_messages`
3) Invio email di notifica tramite Resend verso `CONTACT_TO_EMAIL`
4) (Opzionale futuro) autoresponder al cliente

**Punti chiave**
- Persistenza su DB = storico completo + audit
- Email transazionale = notifica immediata

---

### 4.2 Autenticazione Supabase (B2C + Rivenditori B2B)
**Obiettivo**: login unico, con gestione ruoli applicativi e accesso controllato.

**Modello**
- Tutti gli utenti stanno in `auth.users` (gestito da Supabase)
- Tabella `profiles` per dati applicativi:
  - `id = auth.users.id`
  - `role = customer | retailer | admin`
- Tabella `retailer_applications` per richieste rivenditore:
  - `status = pending | approved | rejected`

**Pagine**
- `/login.html`  
  - login + registrazione email/password
  - (se configurato) OAuth (Google / Apple)
- `/auth/callback.html`  
  - gestione ritorno OAuth (PKCE)
- `/area-rivenditori.html`  
  - pagina protetta (richiede sessione)
  - (logica) se non retailer mostra richiesta accesso / messaggio

**RLS (concetto)**
- `profiles`: utente legge/modifica solo il proprio profilo
- `retailer_applications`: utente crea/legge solo la propria richiesta
- promozione a `retailer`: via dashboard Supabase o API admin (service role)

---

### 4.3 Catalogo prodotti + Negozio (Supabase)
**Obiettivo**: mostrare prodotti da DB e gestire prezzi coerenti.

**Tabella prodotti**
- `products` con campi tipici:
  - `id (uuid)`, `name`, `description`, `category`, `volume_liters`
  - `price_cents`, `currency`
  - `active` (solo prodotti attivi visibili)
  - `sort_order` (ordine di visualizzazione)
  - `image_url` (immagini prodotto)
  - `slug` (opzionale)

**Pagina negozio**
- `/negozio.html`
- JS: `public/js/negozio.js`
  - legge prodotti da Supabase
  - renderizza griglia
  - applica prezzi dinamici in base al ruolo (customer vs retailer)
  - aggiunge al carrello tramite `cart.js`

---

### 4.4 Carrello (client-side)
**Obiettivo**: carrello semplice, stabile e manutenibile.

**Implementazione**
- `public/js/cart.js` (source of truth)
- Storage: `localStorage` (key: `ag_cart_v1`)
- Funzioni:
  - `readCart()`, `writeCart()`
  - `addToCart(productId, qty)`
  - `updateQty(productId, qty)`
  - `removeItem(productId)`
  - `clearCart()`

**Pagina carrello**
- `/carrello.html`
- JS: `public/js/carrello.js`
  - legge cart
  - mostra righe + totale
  - abilita checkout (solo utenti loggati)

---

### 4.5 Pricing (B2C vs B2B)
**Obiettivo**: mostrare prezzo corretto e applicare sconto in modo affidabile.

- UI: calcolo prezzo in `pricing.js` per mostrare stima corretta all’utente
- **Regola critica**: lo sconto retailer **deve essere applicato server-side** in checkout (non fidarsi del client)

Sconto implementato:
- `retailer`: **-10%** su `price_cents`

---

## 5) Checkout Stripe (solo utenti registrati)

### 5.1 Obiettivo
- checkout accessibile solo se l’utente è loggato
- line items creati server-side leggendo i prodotti da Supabase
- sconto retailer applicato server-side
- redirect a Stripe Checkout

### 5.2 Endpoint
- `POST /api/create-checkout-session`
  - riceve carrello `{ items: [{ productId, qty }] }`
  - valida sessione Supabase tramite JWT (`Authorization: Bearer <access_token>`)
  - legge `profiles.role`
  - legge prodotti dal DB
  - crea Stripe Checkout Session con `price_data` dinamico
  - `success_url`: include `?session_id={CHECKOUT_SESSION_ID}`
  - `cancel_url`: ritorno al carrello

### 5.3 Pagine esito
- `/success.html`
  - non “si fida” del redirect
  - verifica ordine via `/api/order-status` (polling breve)
  - svuota carrello solo quando l’ordine risulta “paid”
- `/cancel.html`
  - ritorno al carrello

---

## 6) Ordini salvati su Supabase (Stripe Webhook)

### 6.1 Perché il webhook è fondamentale
Il redirect `success.html` non è una prova affidabile di pagamento.  
L’unica conferma affidabile è l’evento Stripe webhook.

### 6.2 Endpoint webhook
- `POST /api/stripe-webhook`
  - verifica firma Stripe (`Stripe-Signature`) usando **raw body**
  - gestisce almeno:
    - `checkout.session.completed`
  - idempotenza tramite tabella `stripe_events`
  - crea/aggiorna `orders`
  - inserisce `order_items`

### 6.3 Tabelle ordini
- `orders`
  - `stripe_session_id` UNIQUE (chiave naturale)
  - `user_id` (uuid Supabase)
  - `amount_total_cents`, `currency`
  - `payment_status`, `status`
  - `customer_email`
- `order_items`
  - snapshot item: `name_snapshot`, `unit_amount_cents`, `qty`, `currency`
  - `product_id` (uuid Supabase) ricavato da metadata del Product Stripe creato dinamicamente:
    - in checkout: `product_data.metadata.product_id = <uuid products.id>`
    - in webhook: read `lineItem.price.product.metadata.product_id`

### 6.4 Endpoint status ordine (per success page)
- `GET /api/order-status?session_id=cs_...`
  - richiede token utente (Authorization)
  - restituisce l’ordine associato a quel `stripe_session_id` e a quell’utente
  - usato da `success.js` per polling

---

## 7) Gestione domini e webhook (nota operativa)
Stripe non accetta consegne “stabili” se l’endpoint risponde con redirect.

Per webhook è stata adottata la scelta:
- Endpoint Stripe webhook impostato su:
  - `https://www.agricolagentiliorvieto.com/api/stripe-webhook`
- Allineare `STRIPE_WEBHOOK_SECRET` (Stripe Signing Secret) con quella destinazione

---

## 8) Variabili d’ambiente

### 8.1 Vercel (Production)
**Supabase**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (solo se serve al frontend via `/api/public-config`)

**Stripe**
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

**Resend**
- `RESEND_API_KEY`
- `CONTACT_TO_EMAIL`
- `CONTACT_FROM_EMAIL`

### 8.2 Locale
Usare `.env.local` (non committare):
- oppure `vercel env pull .env.local`

---

## 9) Setup locale (standard)

### 9.1 Prerequisiti
- Node.js LTS
- Vercel CLI (`npx vercel` va bene)
- Supabase project attivo
- Stripe account (Test mode)
- Resend account

### 9.2 Install
```bash
npm install


## 10)Struttura repository (reale, aggiornata)
### 10.1 Root
agricolagentili2/
.vercel/
api/
node_modules/
public/
.env.local
.gitignore
package-lock.json
package.json
README.md

shell
Copy code

### 10.2 public/
public/
auth/
callback.html
css/
data/
images/
js/
partials/
area-rivenditori.html
cancel.html
carrello.html
contatti.html
index.html
login.html
negozio.html
olio.html
storia.html
success.html
vini.html

shell
Copy code

### 10.3 public/js/
public/js/
area-rivenditori.js
auth-callback.js
carrello.js
cart.js
contatti.js
footer.js
header.js
login.js
negozio.js
pricing.js
success.js
supabaseClient.js

shell
Copy code

### 10.4 public/partials/
public/partials/
footer.html
header.html

shell
Copy code

### 10.5 api/
api/
contact.js
create-checkout-session.js
health.js
order-status.js
public-config.js
stripe-webhook.js


## 12) Migliorie future (Roadmap completa)

### 12.1 Ordini e UX (alta priorità)
- [ ] Email conferma ordine cliente (via Resend)
- [ ] Email notifica interna “Nuovo ordine” (via Resend)
- [ ] Pagina “I miei ordini” (B2C) con lista ordini + dettaglio righe (line items)
- [ ] Pagina “Ordini rivenditore” (B2B) dedicata (storico + dettaglio righe)
- [ ] Gestione stato ordine: `paid` / `fulfilled` / `shipped` / `refunded` (+ storico stati)
- [ ] Tracking spedizione: salvataggio tracking number + link corriere + timestamp

### 12.2 Stripe: robustezza pagamenti
- [ ] Gestire eventi webhook aggiuntivi:
  - [ ] `payment_intent.succeeded`
  - [ ] `charge.refunded`
  - [ ] `checkout.session.async_payment_*`
- [ ] Salvare in DB indirizzo di spedizione e dettagli cliente (nome, email, telefono se disponibile)
- [ ] Gestire metodi di pagamento asincroni (se abilitati) con stati “pending/confirmed/failed”
- [ ] Rendere idempotente la gestione webhook (deduplica eventi + retry safe)

### 12.3 Catalogo avanzato
- [ ] Pagina prodotto con slug (URL parlante) + metadati SEO (title/description/canonical)
- [ ] Filtri e ricerca: categoria, prezzo, annata, formato, ecc.
- [ ] Immagini ottimizzate: WebP/AVIF, responsive sizes, lazy-load
- [ ] Stock / inventario + flag `active` per gestione disponibilità a catalogo
- [ ] Struttura categorie/attributi estendibile (per future linee prodotto)

### 12.4 B2B evoluto
- [ ] Workflow approvazione rivenditori (auto/manuale) con stati: `pending` / `approved` / `rejected`
- [ ] MOQ e logiche colli/cartoni (quantità minime, multipli per scatola)
- [ ] Listini multipli per rivenditore (non solo -10%): fasce, eccezioni, promo
- [ ] Export ordini (CSV) + gestione fatture / DDT (anche integrazione futura)
- [ ] Regole fiscali B2B (es. validazione P.IVA/VIES, se rilevante)

### 12.5 Sicurezza e operatività
- [ ] Rate limiting su endpoint pubblici (es. `contact`, `checkout`, `auth`)
- [ ] Logging strutturato + monitoraggio errori (Sentry o equivalente)
- [ ] CI GitHub Actions: lint + test + build + preview
- [ ] Security headers (CSP, HSTS, X-Frame-Options, ecc.)
- [ ] Audit trail attività admin (chi ha fatto cosa, quando, da dove)
