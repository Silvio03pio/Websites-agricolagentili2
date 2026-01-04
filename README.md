# Websites-agricolagentili2 — Agricola Gentili (Orvieto)

Sito e-commerce per **Vino & Olio** con:
- catalogo prodotti su **Supabase (Postgres)**
- carrello client-side (localStorage)
- login/registrazione **Supabase** richiesti **solo al checkout**
- pagamenti con **Stripe Checkout**
- ordini salvati su **Supabase** via **Stripe Webhook**
- modulo contatti salvato su DB e notificato via email (**Resend**)

Dominio: **agricolagentiliorvieto.com** (con gestione `www` coerente per Stripe Webhooks)

---

## 1) Obiettivo del progetto
Realizzare un sito moderno e manutenibile, con frontend statico e funzionalità dinamiche server-side tramite API serverless.

### Pilastri (regole del progetto)
- Separazione netta: **frontend statico** (`/public`) + **backend serverless** (`/api/*`)
- Sicurezza: nessuna chiave segreta nel frontend
- Fonte di verità: prezzi e catalogo sul DB (Supabase)
- Checkout affidabile: ordini confermati **solo** da Stripe Webhook (non dalla sola pagina “success”)
- Manutenibilità: ogni pagina ha **un solo JS source-of-truth** (niente duplicati)

---

## 2) Stack e servizi
- **GitHub**: versionamento
- **Vercel**: hosting + Serverless Functions (`/api/*`) + deploy automatici
- **Supabase**
  - Auth (utenti)
  - Database Postgres
  - RLS per protezione dati
- **Stripe**: Checkout e pagamenti (Test mode durante sviluppo)
- **Resend**: email transazionali (contatti + potenziale conferma ordine)

---

## 3) Architettura (anti-confusione)

### 3.1 Frontend vs Backend
- Frontend statico: `/public`  
  HTML/CSS/JS serviti da Vercel come file statici
- Backend serverless: `/api`  
  Funzioni Node (Vercel Serverless Functions)

### 3.2 Segreti (mai nel frontend)
Mai esporre in `/public`:
- Stripe Secret Key
- Stripe Webhook Secret (`whsec_...`)
- Resend API key
- Supabase Service Role Key

Nel frontend sono ammessi solo:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (pubblica per definizione; la sicurezza la garantisce RLS)

### 3.3 Standard risposta JSON per API
Tutti gli endpoint `/api/*` rispondono sempre in JSON:
- `200 { ok: true, ... }`
- `4xx/5xx { ok: false, error: "...", details?: "..." }`

### 3.4 Sviluppo locale
Consigliato usare:
- `vercel dev` → frontend e API sulla stessa origin (niente CORS)

---

## 4) Funzioni implementate (stato reale attuale)

### 4.1 Modulo contatti (Supabase + Resend)
**Obiettivo**: salvare ogni richiesta su DB e notificare il team via email.

**Flow**
1) Form contatti → `POST /api/contact`
2) Salvataggio su tabella Supabase: `contact_messages`
3) Invio email via Resend verso `CONTACT_TO_EMAIL`

**Nota importante Resend**
- `CONTACT_FROM_EMAIL` deve appartenere a un dominio verificato in Resend.
- Se il dominio non è verificato, Resend restituisce errore `domain is not verified`.

---

### 4.2 Catalogo prodotti (Supabase)
**Obiettivo**: mostrare prodotti dal DB e avere prezzi coerenti.

**Tabella prodotti: `products`**
Campi tipici (attesi dal frontend):
- `id (uuid)`
- `name`
- `description`
- `category`
- `volume_liters`
- `price_cents`
- `currency`
- `active` (solo prodotti attivi vengono mostrati)
- `sort_order` (ordine di visualizzazione)
- `image_url`
- `slug` (opzionale)

**Pagina negozio**
- `/negozio.html`
- JS: `public/js/negozio.js`
  - legge `products` da Supabase
  - renderizza la griglia
  - aggiunge al carrello con `cart.js`

---

### 4.3 Carrello (client-side)
**Obiettivo**: carrello semplice e robusto.

**Source of truth**
- `public/js/cart.js`
- Storage: `localStorage` key `ag_cart_v1`

**Funzioni**
- `readCart()`, `writeCart()`
- `addToCart(productId, qty)`
- `updateQty(productId, qty)`
- `removeItem(productId)`
- `clearCart()`

**Pagina carrello**
- `/carrello.html`
- JS: `public/js/carrello.js`
  - mostra righe, totale, quantità e rimozione
  - abilita checkout solo se totale > 0
  - **login richiesto solo al checkout**
  - salva intento checkout in localStorage (`ag_post_login_checkout_v1`) e, dopo login, riavvia checkout automaticamente

---

### 4.4 Autenticazione Supabase (solo per checkout)
**Obiettivo**: mantenere UX semplice: login solo quando serve pagare.

**Pagine**
- `/login.html`
  - login + registrazione email/password
- `/auth/callback.html`
  - (presente se in futuro attivi OAuth) gestione ritorno OAuth PKCE

**Regola**
- utenti anonimi possono navigare negozio e carrello
- quando cliccano Checkout → se non loggati → redirect a login
- dopo login → ritorno al carrello e avvio checkout

---

## 5) Checkout Stripe (login obbligatorio)

### 5.1 Obiettivo
- checkout accessibile solo se l’utente è loggato
- line items creati server-side leggendo i prodotti da Supabase
- raccolta dati necessari (spedizione/telefono) direttamente in Stripe Checkout
- redirect a Stripe Checkout

### 5.2 Endpoint
- `POST /api/create-checkout-session`
  - input: `{ items: [{ productId, qty }] }`
  - valida sessione Supabase tramite JWT (`Authorization: Bearer <access_token>`)
  - legge prodotti da `products` (fonte di verità)
  - crea `stripe.checkout.sessions.create(...)`
  - `success_url`: include `?session_id={CHECKOUT_SESSION_ID}`
  - `cancel_url`: ritorno al carrello

### 5.3 Raccolta indirizzo spedizione e telefono
Configurata in Stripe Checkout:
- `shipping_address_collection` (per chiedere indirizzo)
- `phone_number_collection` (per chiedere telefono)

**Nota**
- Per salvare indirizzo/telefono in Supabase, il webhook deve leggere `session.customer_details` e/o `session.shipping_details` e scriverli su `orders` (Roadmap).

---

## 6) Ordini salvati su Supabase (Stripe Webhook)

### 6.1 Perché il webhook è fondamentale
La pagina `success.html` non prova che il pagamento sia andato a buon fine.  
L’unica conferma affidabile è l’evento Stripe webhook.

### 6.2 Webhook endpoint
- `POST /api/stripe-webhook`
  - verifica firma Stripe con **raw body** (body parser disabilitato)
  - gestisce almeno `checkout.session.completed`
  - idempotenza tramite tabella `stripe_events` (deduplica eventi)
  - crea/aggiorna `orders`
  - inserisce `order_items`

### 6.3 Tabelle ordini (attese)
- `stripe_events`
  - `id` = Stripe Event ID (PK)
- `orders`
  - `stripe_session_id` UNIQUE (chiave naturale)
  - `user_id` (uuid Supabase)
  - `customer_email`
  - `amount_total_cents`, `currency`
  - `payment_status`, `status`
  - `stripe_payment_intent` (opzionale ma utile)
  - timestamps (`created_at`, `updated_at` se presenti)
- `order_items`
  - `order_id` (FK)
  - `product_id` (uuid Supabase, se disponibile)
  - `name_snapshot`
  - `unit_amount_cents`, `qty`, `currency`

### 6.4 Pagina “success” (post pagamento)
- `/success.html` + `public/js/success.js`
  - non si fida del redirect
  - fa polling su `/api/order-status` finché l’ordine risulta salvato come `paid`
  - svuota il carrello solo quando è confermato

### 6.5 Endpoint stato ordine
- `GET /api/order-status?session_id=cs_...`
  - richiede token utente (`Authorization: Bearer`)
  - restituisce ordine associato a `stripe_session_id` e `user_id`

---

## 7) Dominio e webhook (nota operativa)
Stripe può fallire consegna webhook se:
- endpoint risponde con redirect
- `STRIPE_WEBHOOK_SECRET` non corrisponde alla destinazione usata

Scelta operativa adottata:
- Destinazione Stripe webhook:
  - `https://www.agricolagentiliorvieto.com/api/stripe-webhook`
- Su Vercel: `STRIPE_WEBHOOK_SECRET` = signing secret (`whsec_...`) di quella destinazione

---

## 8) Variabili d’ambiente

### 8.1 Vercel (Production)
**Supabase**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (se usato da `/api/public-config` per il frontend)
- `SUPABASE_SERVICE_ROLE_KEY` (solo backend)

**Stripe**
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

**Resend**
- `RESEND_API_KEY`
- `CONTACT_TO_EMAIL`
- `CONTACT_FROM_EMAIL` (mittente verificato su Resend)

### 8.2 Locale
Usare `.env.local` (non committare):
- `vercel env pull .env.local` (consigliato)

---

## 9) Setup locale

### 9.1 Prerequisiti
- Node.js LTS
- Vercel CLI
- Supabase project attivo
- Stripe account (Test mode)
- Resend account (dominio verificato)

### 9.2 Install
```bash
npm install
