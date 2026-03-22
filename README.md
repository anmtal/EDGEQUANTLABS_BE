# EdgeQuantLabs — License Server

Node.js + SQLite license backend for Equity Guard, Chart Lens, and R:R Drawing Tool.

---

## Stack

| Layer | Tool |
|-------|------|
| Server | Express.js |
| Database | SQLite (better-sqlite3, zero setup) |
| Payments | Stripe (Payment Links → webhook) |
| Email | Resend (free 3,000/month) or any SMTP |
| Hosting | Railway (free tier, deploy in 2 min) |

---

## Deploy to Railway (recommended — free)

1. Push this folder to a **private** GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo
4. Go to **Variables** tab and add every variable from `.env.example`
5. Railway gives you a public URL like `https://edgequantlabs-backend-production.up.railway.app`
6. Put that URL in the NT8 tool constant `LicenseServerBaseUrl`

---

## Stripe setup (5 minutes)

1. Create a [Stripe account](https://stripe.com) and verify it
2. Go to **Products** → Create a product for each tool:
   - **Equity Guard** — $149.00 one-time
   - **Chart Lens** — $49.99 one-time
   - **R:R Drawing Tool** — $49.99 one-time
3. For each product, create a **Payment Link**
4. On each Payment Link, open **Metadata** and add:
   ```
   product_id = equity_guard    ← (or chart_lens / rr_tool)
   ```
5. Copy each Payment Link URL → paste into your website's Buy buttons
6. Go to **Developers → Webhooks** → Add endpoint:
   - URL: `https://YOUR-RAILWAY-URL/webhook/stripe`
   - Events: `checkout.session.completed`
7. Copy the **Signing secret** → paste as `STRIPE_WEBHOOK_SECRET` in Railway variables

---

## Email setup with Resend (recommended, free)

1. Create an account at [resend.com](https://resend.com)
2. Add and verify your domain (`edgequantlabs.com`)
3. Create an API key
4. In `.env`:
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=resend
   SMTP_PASS=re_your_api_key_here
   ```

---

## API reference

### `POST /api/activate`
Called by the NT8 tool on first launch.
```json
{ "key": "EG-XXXX-XXXX-XXXX-XXXX", "machineCode": "abc123", "product": "equity_guard" }
```
Returns `{ "success": true }` or `{ "success": false, "message": "..." }`

### `POST /api/validate`
Called on every subsequent launch (key is cached locally in NT8).
```json
{ "key": "EG-XXXX-XXXX-XXXX-XXXX", "machineCode": "abc123", "product": "equity_guard" }
```

### `POST /api/deactivate`
Support use — releases the machine lock so customer can activate on a new machine.
```json
{ "key": "EG-XXXX-XXXX-XXXX-XXXX", "adminSecret": "your_admin_secret" }
```

### `GET /api/admin/licenses`
Lists all issued licenses. Requires header: `x-admin-secret: your_admin_secret`

---

## Manually issue a key (for free copies / beta testers)

```bash
# SSH into Railway shell or run locally:
node -e "
const db = require('better-sqlite3')('./licenses.db');
const crypto = require('crypto');
const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
const key = \`EG-\${seg()}-\${seg()}-\${seg()}-\${seg()}\`;
db.prepare(\"INSERT INTO licenses (key, product, email) VALUES (?,?,?)\")
  .run(key, 'equity_guard', 'beta@example.com');
console.log('Key:', key);
"
```

---

## Transfer a license (customer gets a new machine)

```bash
curl -X POST https://YOUR-URL/api/deactivate \
  -H "Content-Type: application/json" \
  -d '{"key":"EG-XXXX-XXXX-XXXX-XXXX","adminSecret":"your_admin_secret"}'
```

---

## Product IDs

| Tool | product_id | Key prefix |
|------|-----------|------------|
| Equity Guard | `equity_guard` | `EG-` |
| Chart Lens | `chart_lens` | `CL-` |
| R:R Drawing Tool | `rr_tool` | `RR-` |
