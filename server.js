// ─────────────────────────────────────────────────────────────────────────────
// EdgeQuantLabs — License Server
// Stack: Express · SQLite (better-sqlite3) · Stripe · Nodemailer
//
// Endpoints:
//   POST /api/activate        — called by NT8 tool on first launch
//   POST /api/validate        — called by NT8 tool on every subsequent launch
//   POST /api/deactivate      — called when customer wants to move machine
//   POST /webhook/stripe      — Stripe calls this on successful payment
//
// Deploy free on Railway: https://railway.app
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const Database   = require("better-sqlite3");
const Stripe     = require("stripe");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const crypto     = require("crypto");
const path       = require("path");

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ── Database setup ────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, "licenses.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    key           TEXT    NOT NULL UNIQUE,
    product       TEXT    NOT NULL,
    email         TEXT    NOT NULL,
    machine_id    TEXT,
    activated_at  TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    stripe_session TEXT,
    is_revoked    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS activation_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    action     TEXT NOT NULL,
    timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
    ip         TEXT
  );
`);

// ── Middleware ────────────────────────────────────────────────────────────────
// Stripe webhooks need raw body — mount before express.json()
app.use("/webhook/stripe", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(cors({ origin: ["https://anmtal.github.io", "http://localhost:3000"] }));

// ── Key generator ─────────────────────────────────────────────────────────────
// Format:  EG-XXXX-XXXX-XXXX-XXXX  (Equity Guard)
//          CL-XXXX-XXXX-XXXX-XXXX  (Chart Lens)
//          RR-XXXX-XXXX-XXXX-XXXX  (R:R Tool)
const PRODUCT_PREFIXES = {
  equity_guard : "EG",
  chart_lens   : "CL",
  rr_tool      : "RR",
};

function generateKey(product) {
  const prefix = PRODUCT_PREFIXES[product] || "EQ";
  const seg = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${prefix}-${seg()}-${seg()}-${seg()}-${seg()}`;
}

// ── Email sender ──────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const PRODUCT_NAMES = {
  equity_guard : "Equity Guard",
  chart_lens   : "Chart Lens",
  rr_tool      : "R:R Drawing Tool",
};

async function sendLicenseEmail(email, key, product) {
  const productName = PRODUCT_NAMES[product] || product;

  await mailer.sendMail({
    from    : `"EdgeQuantLabs" <${process.env.SMTP_USER}>`,
    to      : email,
    subject : `Your ${productName} License Key — EdgeQuantLabs`,
    html    : `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:8px;overflow:hidden;border:1px solid #2a2a4a;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0d4f6e,#1a2a5e);padding:32px 40px;text-align:center;">
          <div style="font-size:36px;margin-bottom:8px;">🛡</div>
          <div style="color:#00d4ff;font-size:22px;font-weight:bold;letter-spacing:2px;">EDGEQUANTLABS</div>
          <div style="color:#a0c0d0;font-size:13px;margin-top:4px;">Engineered for Performance</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="color:#e0e0f0;font-size:16px;margin:0 0 8px;">Thank you for your purchase!</p>
          <p style="color:#a0a0c0;font-size:14px;margin:0 0 28px;">
            Your <strong style="color:#ffffff;">${productName}</strong> license key is below.
            Keep it safe — you'll need it to activate the tool in NinjaTrader 8.
          </p>

          <!-- Key box -->
          <div style="background:#0d0d1f;border:2px solid #00d4ff;border-radius:6px;padding:20px;text-align:center;margin-bottom:28px;">
            <div style="color:#888;font-size:11px;letter-spacing:1px;margin-bottom:8px;">YOUR LICENSE KEY</div>
            <div style="color:#00d4ff;font-size:22px;font-weight:bold;letter-spacing:3px;font-family:monospace;">${key}</div>
          </div>

          <!-- Instructions -->
          <div style="background:#12122a;border-radius:6px;padding:20px;margin-bottom:28px;">
            <div style="color:#ffffff;font-size:14px;font-weight:bold;margin-bottom:12px;">How to activate:</div>
            <ol style="color:#a0a0c0;font-size:13px;margin:0;padding-left:20px;line-height:2;">
              <li>Copy the license key above</li>
              <li>Open NinjaTrader 8 → New → Equity Guard</li>
              <li>Paste your key into the activation dialog and click <strong style="color:#fff;">Activate</strong></li>
              <li>Done — the tool is now locked to your machine</li>
            </ol>
          </div>

          <p style="color:#606080;font-size:12px;line-height:1.6;">
            This license is locked to <strong>1 machine</strong>. If you need to transfer it to a new machine,
            reply to this email and we'll deactivate your old machine within 24 hours.<br><br>
            Questions? Email us at <a href="mailto:hello@edgequantlabs.com" style="color:#00d4ff;">hello@edgequantlabs.com</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0d0d1f;padding:20px 40px;text-align:center;border-top:1px solid #2a2a4a;">
          <div style="color:#404060;font-size:11px;">© 2026 EdgeQuantLabs · All rights reserved</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

// ── API: Activate ─────────────────────────────────────────────────────────────
// Called by NT8 on first use or when no cached key exists.
// Body: { key, machineCode, product }
// Response: { success: true } or { success: false, message: "..." }
app.post("/api/activate", (req, res) => {
  const { key, machineCode, product } = req.body || {};
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  if (!key || !machineCode || !product) {
    return res.json({ success: false, message: "Missing required fields." });
  }

  const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get(key.trim().toUpperCase());

  if (!license) {
    log(key, machineCode, "activate_fail_notfound", ip);
    return res.json({ success: false, message: "License key not found. Please check the key and try again." });
  }

  if (license.is_revoked) {
    log(key, machineCode, "activate_fail_revoked", ip);
    return res.json({ success: false, message: "This license has been revoked. Please contact support." });
  }

  if (license.product !== product) {
    log(key, machineCode, "activate_fail_wrong_product", ip);
    return res.json({ success: false, message: `This key is for ${PRODUCT_NAMES[license.product] || license.product}, not ${PRODUCT_NAMES[product] || product}.` });
  }

  // Already activated on this machine — allow (re-activation after reinstall)
  if (license.machine_id === machineCode) {
    log(key, machineCode, "activate_ok_same_machine", ip);
    return res.json({ success: true });
  }

  // Already activated on a DIFFERENT machine — block
  if (license.machine_id && license.machine_id !== machineCode) {
    log(key, machineCode, "activate_fail_machine_mismatch", ip);
    return res.json({
      success: false,
      message: "This key is already activated on another machine. To transfer your license, email hello@edgequantlabs.com."
    });
  }

  // First activation — lock to this machine
  db.prepare(`
    UPDATE licenses SET machine_id = ?, activated_at = datetime('now') WHERE key = ?
  `).run(machineCode, key.trim().toUpperCase());

  log(key, machineCode, "activate_ok_first", ip);
  return res.json({ success: true });
});

// ── API: Validate ─────────────────────────────────────────────────────────────
// Called on every subsequent launch (key is cached locally).
// Body: { key, machineCode, product }
app.post("/api/validate", (req, res) => {
  const { key, machineCode, product } = req.body || {};
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  if (!key || !machineCode) {
    return res.json({ success: false, message: "Missing fields." });
  }

  const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get(key.trim().toUpperCase());

  if (!license || license.is_revoked) {
    log(key, machineCode, "validate_fail", ip);
    return res.json({ success: false, message: "License invalid or revoked." });
  }

  if (license.machine_id && license.machine_id !== machineCode) {
    log(key, machineCode, "validate_fail_machine", ip);
    return res.json({ success: false, message: "License is registered to a different machine." });
  }

  log(key, machineCode, "validate_ok", ip);
  return res.json({ success: true });
});

// ── API: Deactivate ───────────────────────────────────────────────────────────
// Used by support to release a machine slot. Protected by admin secret.
// Body: { key, adminSecret }
app.post("/api/deactivate", (req, res) => {
  const { key, adminSecret } = req.body || {};

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: "Unauthorized." });
  }

  const license = db.prepare("SELECT * FROM licenses WHERE key = ?").get(key?.trim().toUpperCase());
  if (!license) return res.json({ success: false, message: "Key not found." });

  db.prepare("UPDATE licenses SET machine_id = NULL, activated_at = NULL WHERE key = ?")
    .run(key.trim().toUpperCase());

  return res.json({ success: true, message: "Machine deactivated. Customer can activate on a new machine." });
});

// ── API: Admin — list all licenses ───────────────────────────────────────────
app.get("/api/admin/licenses", (req, res) => {
  if (req.headers["x-admin-secret"] !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  const rows = db.prepare("SELECT * FROM licenses ORDER BY created_at DESC").all();
  res.json(rows);
});

// ── API: Admin — generate a key from the browser ──────────────────────────────
// Usage: /api/admin/generate?secret=YOUR_ADMIN_SECRET&product=equity_guard&email=test@test.com
app.get("/api/admin/generate", (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }

  const product = req.query.product || "equity_guard";
  const email   = req.query.email   || "manual@edgequantlabs.com";

  let licenseKey, attempts = 0;
  do {
    const seg = () => crypto.randomBytes(2).toString("hex").toUpperCase();
    const prefix = PRODUCT_PREFIXES[product] || "EQ";
    licenseKey = `${prefix}-${seg()}-${seg()}-${seg()}-${seg()}`;
    attempts++;
  } while (db.prepare("SELECT id FROM licenses WHERE key = ?").get(licenseKey) && attempts < 10);

  db.prepare("INSERT INTO licenses (key, product, email) VALUES (?, ?, ?)").run(licenseKey, product, email);

  res.json({ success: true, key: licenseKey, product, email });
});

// ── API: Admin — revoke a key ─────────────────────────────────────────────────
// Usage: /api/admin/revoke?secret=YOUR_ADMIN_SECRET&key=EG-XXXX-XXXX-XXXX-XXXX
app.get("/api/admin/revoke", (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  const key = req.query.key?.trim().toUpperCase();
  if (!key) return res.json({ success: false, message: "No key provided." });
  db.prepare("UPDATE licenses SET is_revoked = 1 WHERE key = ?").run(key);
  res.json({ success: true, message: `Key ${key} has been revoked.` });
});

// ── Stripe Webhook ────────────────────────────────────────────────────────────
// Stripe calls this when a checkout session is completed.
// We generate the license key and email it to the customer.
//
// In your Stripe dashboard, create a Payment Link for each product and add
// these metadata keys to each price:  product_id = "equity_guard" (or chart_lens / rr_tool)
app.post("/webhook/stripe", async (req, res) => {
  const sig     = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature failure:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session  = event.data.object;
    const email    = session.customer_details?.email;
    const product  = session.metadata?.product_id || "equity_guard";

    if (!email) {
      console.error("No email in Stripe session:", session.id);
      return res.json({ received: true });
    }

    // Generate unique key
    let licenseKey;
    let attempts = 0;
    do {
      licenseKey = generateKey(product);
      attempts++;
    } while (db.prepare("SELECT id FROM licenses WHERE key = ?").get(licenseKey) && attempts < 10);

    // Store in database
    db.prepare(`
      INSERT INTO licenses (key, product, email, stripe_session)
      VALUES (?, ?, ?, ?)
    `).run(licenseKey, product, email, session.id);

    // Email the key to the customer
    try {
      await sendLicenseEmail(email, licenseKey, product);
      console.log(`License ${licenseKey} issued to ${email} for ${product}`);
    } catch (mailErr) {
      console.error("Email send failed:", mailErr.message);
      // Key is still in DB — can be retrieved from admin panel
    }
  }

  res.json({ received: true });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(key, machineCode, action, ip) {
  try {
    db.prepare(`
      INSERT INTO activation_log (key, machine_id, action, ip)
      VALUES (?, ?, ?, ?)
    `).run(key, machineCode, action, ip || "unknown");
  } catch (_) {}
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`EdgeQuantLabs license server running on port ${PORT}`);
});
