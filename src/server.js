require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const crypto        = require('crypto');
const fs            = require('fs');
const os            = require('os');
const path = require('path');
const { init: vwoInit } = require('vwo-fme-node-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());

// ─────────────────────────────────────────────
// Visitor identity middleware
// Assigns a stable anonymous visitor ID via cookie.
// Your experimentation SDK can use this to bucket
// users consistently across requests.
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  let visitorId = req.cookies.visitor_id;
  if (!visitorId) {
    visitorId = uuidv4();
    res.cookie('visitor_id', visitorId, {
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  req.visitorId = visitorId;
  next();
});

// ─────────────────────────────────────────────
// Credentials store & encryption
//
// Credentials are keyed by email address and persisted to disk so
// they survive server restarts. Sensitive fields (sdkKey, apiKey,
// recoToken) are encrypted at rest with AES-256-GCM.
//
// Set ENCRYPTION_KEY=<64-char hex> in .env — required for decryption
// to work across restarts. Without it an ephemeral key is generated
// and any previously-encrypted credentials become unreadable on restart.
// ─────────────────────────────────────────────
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  : (() => {
      const k = crypto.randomBytes(32);
      console.warn('⚠️  No ENCRYPTION_KEY set — using ephemeral key. Encrypted credentials unreadable after restart.');
      console.warn(`   To persist, add to .env:  ENCRYPTION_KEY=${k.toString('hex')}`);
      return k;
    })();

const VWO_ACCOUNT_ID = process.env.VWO_ACCOUNT_ID || null;
const VWO_SDK_KEY    = process.env.VWO_SDK_KEY    || null;

// Persistent file paths — os.tmpdir() is writable on all platforms (including Vercel /tmp)
const CREDS_FILE   = path.join(os.tmpdir(), 'tn-credentials.json');
const VEMAP_FILE   = path.join(os.tmpdir(), 'tn-visitor-email.json');

// In-memory stores — hydrated from disk at startup
const credStore       = new Map(); // email      → { email, accountId, sdkKey(enc), apiKey(enc), recoId, recoToken(enc), abtId, theme }
const visitorEmailMap = new Map(); // visitorId  → email

function _saveCredStore() {
  const obj = {};
  credStore.forEach((v, k) => { obj[k] = v; });
  try { fs.writeFileSync(CREDS_FILE, JSON.stringify(obj)); } catch(e) {
    console.warn('[store] Failed to persist credentials:', e.message);
  }
}

function _saveVisitorEmailMap() {
  const obj = {};
  visitorEmailMap.forEach((v, k) => { obj[k] = v; });
  try { fs.writeFileSync(VEMAP_FILE, JSON.stringify(obj)); } catch(e) {
    console.warn('[store] Failed to persist visitor-email map:', e.message);
  }
}

// Load from disk on startup
try {
  const data = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  Object.entries(data).forEach(([k, v]) => credStore.set(k, v));
  console.log(`[store] Loaded ${credStore.size} credential record(s) from disk`);
} catch(e) { /* first run or unreadable */ }

try {
  const data = JSON.parse(fs.readFileSync(VEMAP_FILE, 'utf8'));
  Object.entries(data).forEach(([k, v]) => visitorEmailMap.set(k, v));
} catch(e) { /* first run */ }

// ─────────────────────────────────────────────
// VWO Feature Experimentation client
// Initialised at module load so Vercel serverless cold starts
// have the client ready before the first request is handled.
// ─────────────────────────────────────────────
let vwoClient = null;

async function initVwoClient(sdkKey, accountId) {
  try {
    vwoClient = await vwoInit({
      accountId:    String(accountId),
      sdkKey:       String(sdkKey),
      pollInterval: 60000,
      logger:       { level: 'ERROR' },
    });
    console.log('✅  VWO FME client ready (accountId:', accountId, ')');
  } catch(e) {
    vwoClient = null;
    console.error('❌  VWO FME init failed:', e.message);
  }
}

const vwoReady = (VWO_SDK_KEY && VWO_ACCOUNT_ID)
  ? initVwoClient(VWO_SDK_KEY, VWO_ACCOUNT_ID)
  : Promise.resolve();

function encrypt(text) {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc.toString('hex') });
}

function decrypt(stored) {
  if (!stored) return null;
  try {
    const { iv, tag, data } = JSON.parse(stored);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return decipher.update(Buffer.from(data, 'hex'), undefined, 'utf8') + decipher.final('utf8');
  } catch(e) {
    return null;
  }
}

// GET /api/health — confirms VWO client status (useful for diagnosing serverless cold starts)
app.get('/api/health', async (req, res) => {
  await vwoReady;
  res.json({
    vwoClientReady: !!vwoClient,
    hasAccountId: !!VWO_ACCOUNT_ID,
    hasSdkKey: !!VWO_SDK_KEY,
  });
});

// Serve the VWO FME client-side SDK bundle
app.get('/vwo-sdk.js', (req, res) => {
  res.sendFile(path.join(__dirname, '../node_modules/vwo-fme-node-sdk/dist/client/vwo-fme-javascript-sdk.min.js'));
});

// GET /api/config — returns the visitor's own VWO credentials for client-side SDK init.
// Looks up by visitorId first; falls back to ?email= query param for cross-device / post-restart recovery.
app.get('/api/config', (req, res) => {
  const email = visitorEmailMap.get(req.visitorId) || req.query.email || null;
  const c     = email ? credStore.get(email) : null;
  if (!c?.sdkKey) return res.json({ hasCredentials: false, visitorId: req.visitorId });

  // Re-associate this visitor with the email if it came in via query param
  if (!visitorEmailMap.has(req.visitorId) && email) {
    visitorEmailMap.set(req.visitorId, email);
    _saveVisitorEmailMap();
  }

  res.json({
    hasCredentials: true,
    email:     c.email     || null,
    accountId: c.accountId,
    sdkKey:    decrypt(c.sdkKey),
    recoId:    c.recoId    || null,
    recoToken: c.recoToken ? decrypt(c.recoToken) : null,
    abtId:     c.abtId     || null,
    theme:     c.theme     || null,
    visitorId: req.visitorId,
  });
});

// POST /api/verify-email — gate access via VWO SCDemosite flag
// The email is used as the visitor ID; the flag variable 'grantaccess'
// must be true for the visitor to proceed through credential setup.
app.post('/api/verify-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  await vwoReady;
  if (!vwoClient) {
    console.warn('[VWO] verify-email: no client initialised — allowing through');
    return res.json({ approved: true });
  }

  try {
    const flag = await vwoClient.getFlag('scDemoSite', { id: email, customVariables: { useremail: email } });
    const isEnabled   = flag.isEnabled();
    const grantaccess = flag.getVariable('grantaccess', false);
    const approved    = isEnabled && grantaccess === true;
    res.json({ approved });
  } catch(e) {
    console.error('[VWO] SCDemosite check failed:', e.message);
    res.status(500).json({ error: 'Verification service unavailable' });
  }
});

// POST /api/credentials — save the visitor's own VWO account credentials.
// Keyed by email. Sensitive fields are encrypted before writing to the store.
app.post('/api/credentials', (req, res) => {
  const { email, accountId, sdkKey, apiKey, recoId, recoToken, abtId, theme } = req.body;
  if (!accountId || !sdkKey)
    return res.status(400).json({ error: 'accountId and sdkKey are required' });

  const credEmail = (email || visitorEmailMap.get(req.visitorId) || '').toLowerCase().trim();
  if (!credEmail) return res.status(400).json({ error: 'email is required' });

  const existing = credStore.get(credEmail) || {};
  credStore.set(credEmail, {
    email:     credEmail,
    accountId: String(accountId),
    sdkKey:    encrypt(sdkKey),
    apiKey:    apiKey     ? encrypt(apiKey)    : existing.apiKey    || null,
    recoId:    recoId     || existing.recoId   || null,
    recoToken: recoToken  ? encrypt(recoToken) : existing.recoToken || null,
    abtId:     abtId      || existing.abtId    || null,
    theme:     theme      || existing.theme    || null,
  });

  visitorEmailMap.set(req.visitorId, credEmail);
  _saveCredStore();
  _saveVisitorEmailMap();
  res.json({ ok: true });
});

// POST /api/check-theme
// Evaluates the demoTheme flag using the server-side VWO client (.env credentials)
// with a usertheme custom variable so the flag can target by theme selection.
app.post('/api/check-theme', async (req, res) => {
  const { usertheme } = req.body;
  if (!usertheme) return res.status(400).json({ error: 'usertheme required' });

  await vwoReady;
  if (!vwoClient) {
    console.log('[VWO] check-theme: no client initialised — returning null');
    return res.json({ theme: null });
  }

  try {
    const flag = await vwoClient.getFlag('demoTheme', {
      id: req.visitorId,
      customVariables: { usertheme },
    });
    const isEnabled = flag.isEnabled();
    const theme = isEnabled ? flag.getVariable('theme', null) : null;
    console.log('[VWO] demoTheme — visitor:', req.visitorId, '| usertheme:', usertheme, '| enabled:', isEnabled, '| theme:', theme);
    res.json({ theme, isEnabled });
  } catch(e) {
    console.error('[VWO] check-theme error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/setup-flags
// Checks the visitor's VWO account for the Recommendations flag.
// If it exists, stops. If not, creates it with 3 string variables (homepage, pdp, cart IDs).
app.post('/api/setup-flags', async (req, res) => {
  const email = visitorEmailMap.get(req.visitorId);
  const c     = email ? credStore.get(email) : null;
  if (!c?.apiKey) return res.status(400).json({ error: 'No API key stored' });

  const apiKey = decrypt(c.apiKey);
  const FLAG_KEY = 'recommendations';
  const base    = 'https://app.vwo.com/api/v2/accounts/current';
  const headers = { 'token': apiKey, 'Content-Type': 'application/json' };

  try {
    // Step 1: Check if Recommendations flag already exists
    const listRes = await fetch(`${base}/features?limit=25`, { headers });
    if (!listRes.ok) {
      const body = await listRes.text();
      console.error('[VWO API] list features failed:', listRes.status, body);
      return res.status(502).json({ error: 'VWO API error', status: listRes.status, detail: body });
    }
    const listData = await listRes.json();
    // Response is a bare array or wrapped in _data
    const existing = Array.isArray(listData) ? listData : (listData._data ?? []);
    const existingKeys = existing.map(f => f.featureKey ?? '');

    if (existingKeys.includes(FLAG_KEY)) {
      console.log('[VWO API] Recommendations flag already exists — skipping creation');
      return res.json({ created: false, message: 'Recommendations flag already exists' });
    }

    // Step 2: Create the Recommendations flag with 3 ID variables
    const createRes = await fetch(`${base}/features`, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        name:        'Recommendations',
        featureKey:  FLAG_KEY,
        featureType: 'PERMANENT',
        variables: [
          { variableName: 'homepage_id', dataType: 'string', defaultValue: 'none' },
          { variableName: 'pdp_id',      dataType: 'string', defaultValue: 'none' },
          { variableName: 'cart_id',     dataType: 'string', defaultValue: 'none' },
        ],
      }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      console.error('[VWO API] create feature failed:', createRes.status, body);
      return res.status(502).json({ error: 'Failed to create flag', status: createRes.status, detail: body });
    }

    const created = await createRes.json();
    const flagId = created?._data?.id ?? null;
    console.log('[VWO API] Recommendations flag created successfully, id:', flagId);
    res.json({ created: true, message: 'Recommendations flag created', id: flagId });
  } catch (e) {
    console.error('[VWO API] setup-flags error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/search — proxy to Wingify Commerce Search API (avoids browser CORS restrictions)
app.get('/api/search', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).json({ error: 'text required' });

  const email = visitorEmailMap.get(req.visitorId);
  const c     = email ? credStore.get(email) : null;
  const abtId = c?.abtId || null;
  if (!abtId) return res.json({ hits: [], totalHits: 0, totalPages: 0, page: 0, noIdentifier: true });

  // Use subdomain-based URL per getting-started guide:
  // https://{identifier}.search.abtasty.com/search  (no index param needed)
  const rawQs = req.originalUrl.split('?')[1] || '';

  try {
    const upstreamUrl = `https://${abtId}.search.abtasty.com/search?${rawQs}`;
    console.log('[Search proxy] upstream URL:', upstreamUrl);
    const upstream = await fetch(upstreamUrl);
    const body = await upstream.json();
    console.log('[Search proxy] status:', upstream.status, '| hits:', body.hits?.length, '| facets:', JSON.stringify(body.facets));
    res.status(upstream.status).json(body);
  } catch(e) {
    console.error('[Search proxy]', e.message);
    res.status(502).json({ error: 'Search unavailable', detail: e.message });
  }
});

// GET /api/autocomplete — proxy to Wingify Commerce Autocomplete API (avoids browser CORS restrictions)
app.get('/api/autocomplete', async (req, res) => {
  const { text, hitsPerPage } = req.query;
  if (!text) return res.json({ suggestions: [] });

  const email = visitorEmailMap.get(req.visitorId);
  const c     = email ? credStore.get(email) : null;
  const abtId = c?.abtId || null;
  if (!abtId) return res.json({ suggestions: [] });

  const params = new URLSearchParams({ client_id: abtId, query: text });
  if (hitsPerPage) params.set('hits_per_page', hitsPerPage);

  try {
    const upstream = await fetch(`https://search-api.abtasty.com/autocomplete?${params}`);
    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch(e) {
    console.error('[Autocomplete proxy]', e.message);
    res.json({ suggestions: [] });
  }
});

// DELETE /api/credentials — clear everything for this visitor
app.delete('/api/credentials', (req, res) => {
  const email = visitorEmailMap.get(req.visitorId);
  if (email) {
    credStore.delete(email);
    _saveCredStore();
  }
  visitorEmailMap.delete(req.visitorId);
  _saveVisitorEmailMap();
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
// Server-side experimentation endpoint
//
// GET /api/experiments
//
// Returns the active feature flags / variation
// assignments for this visitor. Wire your AB Tasty
// (or any flag SDK) in here — the client reads this
// on load and applies the right experience before
// rendering, eliminating flicker.
//
// Example response:
// {
//   "heroVariant": "control" | "variant_a",
//   "promoLayout": "grid" | "carousel",
//   "recommendationAlgo": "collab" | "trending"
// }
// ─────────────────────────────────────────────
app.get('/api/experiments', async (req, res) => {
  const assignments = await resolveExperiments(req.visitorId);
  res.json({ visitorId: req.visitorId, ...assignments });
});

// ─────────────────────────────────────────────
// Analytics / event ingestion endpoint
//
// POST /api/events
// Body: { event, properties }
//
// Forward to your data warehouse, AB Tasty, or
// any analytics destination from here.
// ─────────────────────────────────────────────
app.post('/api/events', (req, res) => {
  const { event, properties } = req.body;
  console.log(`[event] visitor=${req.visitorId} event=${event}`, properties || '');
  // TODO: forward to your analytics pipeline
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
// Products API — swap static data for a DB later
// ─────────────────────────────────────────────
const { PRODUCTS, COLLECTIONS } = require('./data');

app.get('/api/products', (req, res) => {
  const { category, limit } = req.query;
  let results = PRODUCTS;
  if (category) results = results.filter(p => p.category === category);
  if (limit)    results = results.slice(0, parseInt(limit));
  res.json(results);
});

app.get('/api/products/:id', (req, res) => {
  const product = PRODUCTS.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(product);
});

app.get('/api/collections', (req, res) => res.json(COLLECTIONS));

// ─────────────────────────────────────────────
// Serve the frontend
// All non-API routes fall through to index.html
// (supports client-side routing)
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─────────────────────────────────────────────
// Experiment resolution — VWO FME SDK with deterministic fallback
//
// Flag keys expected in your VWO account:
//   hero_variant    → variable: "variant"  (string: "control" | "variant_a")
//   promo_layout    → variable: "layout"   (string: "grid" | "carousel" | "editorial")
//   enable_wishlist → (boolean flag, no variables needed)
// ─────────────────────────────────────────────
async function resolveExperiments(visitorId) {
  await vwoReady;
  if (vwoClient) {
    try {
      const ctx = { id: visitorId };
      const [heroFlag, promoFlag, wishlistFlag] = await Promise.all([
        vwoClient.getFlag('hero_variant',    ctx),
        vwoClient.getFlag('promo_layout',    ctx),
        vwoClient.getFlag('enable_wishlist', ctx),
      ]);
      return {
        heroVariant:         heroFlag.isEnabled()     ? heroFlag.getVariable('variant', 'control') : 'control',
        promoLayout:         promoFlag.isEnabled()    ? promoFlag.getVariable('layout',  'grid')   : 'grid',
        recommendationAlgo:  'trending',
        showFreeShippingBar: true,
        enableWishlist:      wishlistFlag.isEnabled(),
        vwoEnabled:          true,
      };
    } catch(e) {
      console.error('[VWO] getFlag error:', e.message);
    }
  }
  return resolveFallbackExperiments(visitorId);
}

function resolveFallbackExperiments(visitorId) {
  const bucket = visitorIdToBucket(visitorId);
  return {
    heroVariant:         bucket < 50 ? 'control' : 'variant_a',
    promoLayout:         bucket < 33 ? 'grid' : bucket < 66 ? 'carousel' : 'editorial',
    recommendationAlgo:  bucket < 50 ? 'collaborative' : 'trending',
    showFreeShippingBar: true,
    enableWishlist:      bucket < 80,
    vwoEnabled:          false,
  };
}

function visitorIdToBucket(id) {
  // Simple hash → 0–99 bucket
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

if (require.main === module) {
  if (!VWO_SDK_KEY || !VWO_ACCOUNT_ID) {
    console.warn('   ⚠️  VWO_SDK_KEY or VWO_ACCOUNT_ID not set — FME falling back to deterministic bucketing');
    console.warn('   Add them to .env to enable live flag resolution\n');
  }
  app.listen(PORT, () => {
    console.log(`\n🍁 True North running at http://localhost:${PORT}`);
    console.log(`   Experiments API: http://localhost:${PORT}/api/experiments`);
    console.log(`   Products API:    http://localhost:${PORT}/api/products\n`);
  });
}

module.exports = app;
