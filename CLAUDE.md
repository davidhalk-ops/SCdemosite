# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**True North** is a Canadian-themed mock ecommerce store used as a demo platform for server-side feature experimentation with VWO (Visual Website Optimizer) Feature Management & Experimentation (FME), and AB Tasty Commerce (Search, Recommendations). It demonstrates zero-flicker A/B testing via server-side experiment resolution.

## Commands

```bash
# Install dependencies
npm install

# Start production server
npm start

# Start dev server with auto-reload
npm run dev
```

There is no build step, test runner, or linter configured — this is a vanilla Node.js/Express project.

## Environment Variables

Copy `.env.example` to `.env` and populate:

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | `development` or `production` |
| `VWO_SDK_KEY` | VWO server-side SDK key |
| `VWO_ACCOUNT_ID` | VWO account ID |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM credential encryption — **required for persistence across restarts**; auto-generated (ephemeral) if unset |

## Architecture

### Backend (`src/server.js`)

Express REST API with server-side experiment resolution. Key flows:

1. **Visitor Identity** — Every request passes through middleware that assigns a UUID via an HTTP-only cookie (1-year TTL). This UUID is the stable identity for VWO bucketing.

2. **VWO FME SDK** — Initialized once at module load via `vwo-fme-node-sdk` (module-level `vwoReady` promise). The main integration point is `GET /api/experiments`, which resolves flag values (`hero_variant`, `promo_layout`, `enable_wishlist`) before the page renders, eliminating flicker.

3. **Deterministic Fallback** — If the VWO SDK is unavailable, a simple string hash maps visitor IDs to buckets 0–99 for consistent assignment without VWO.

4. **Credential Store** — Visitors store their own VWO + AB Tasty credentials during onboarding. Credentials are:
   - **Keyed by email address** (not by cookie/visitorId) so the same user is recognised across browsers and server restarts.
   - **Encrypted at rest**: `sdkKey`, `apiKey`, and `recoToken` are AES-256-GCM encrypted before writing; decrypted transparently on read.
   - **Persisted to disk** in two JSON files in `os.tmpdir()` (`tn-credentials.json`, `tn-visitor-email.json`), loaded on startup.
   - **Mirrored to `localStorage`** (`tn_creds`) on the client. On every page load, `boot()` silently restores credentials from `localStorage` to the server via `POST /api/credentials` before fetching `/api/config`, so the gate is never shown again after initial setup — even after a Vercel cold start.
   - The `visitorId` cookie is still used for VWO experiment bucketing, but credential lookup goes email → credentials.
   - `apiKey` (VWO REST API key) is never returned by `GET /api/config`.

5. **VWO REST API Integration** — `POST /api/setup-flags` auto-creates flags in VWO via the management REST API. The current flag is `recommendations` (key: `recommendations`, type: `PERMANENT`) with variables `homepage_id`, `pdp_id`, and `cart_id` (all `string`, default `"none"`).

6. **Theme Selection** — `POST /api/check-theme` evaluates the `demoTheme` flag using the server-side VWO client (`.env` credentials). Called during onboarding with a `usertheme` custom variable (`"canada"` or `"france"`). Returns `{ theme, isEnabled }` and logs both values server-side.

7. **AB Tasty Search Proxy** — `GET /api/search` proxies to `https://search-api.abtasty.com/search` to avoid browser CORS restrictions. Uses the visitor's stored `abtId` credential as the index (`{abtId}_Catalog`); falls back to a demo identifier if not set.

8. **Products & Collections** — Static data in `src/data.js` (8 products, 6 collections). `GET /api/products` supports `?category=` and `?limit=` filters.

### Frontend (`public/index.html`)

Single-file SPA (HTML + inline CSS + inline JS). No bundler or framework. The frontend:
- Calls `GET /api/experiments` on load to receive pre-resolved flag values
- Renders hero/promo variants based on the response
- Dynamically injects the VWO FME JavaScript SDK tag for client-side tracking
- Uses Playfair Display / DM Sans fonts with a Canadian red (`#C8102E`) / pine green / gold palette

### Onboarding Gate (`gateState`)

8-step flow rendered by `buildGateHTML()` / `handleGateNext()`. Every step except `email` has a ← Back button. Navigation is driven by `GATE_BACK_MAP` and `gateBack()`.

| Step key | Collects | Notes |
|---|---|---|
| `email` | Email address | Verified against VWO `scDemoSite` flag |
| `theme` | Radio: Canadian (`canada`) / French (`france`) | Calls `/api/check-theme` on selection; logs `demoTheme` flag result immediately |
| `account-id` | VWO Account ID | Client-side SDK init |
| `sdk-key` | Feature Experimentation SDK Key | Client-side SDK init |
| `api-key` | VWO API Key | Used server-side by `/api/setup-flags` only; never returned by `/api/config`. Has note + Skip button |
| `reco-id` | AB Tasty Commerce Site ID | Stored as `recoId` |
| `reco-token` | AB Tasty Commerce API Key | Stored as `recoToken` |
| `abt-id` | AB Tasty Identifier | Same identifier used for Web Experimentation. Powers Search. Stored as `abtId`. Final step — triggers credential save and flag setup |

After the final step, `siteConfig` is updated in-memory and credentials are saved to `localStorage`.

### Manage Credentials Panel

Footer link opens `#creds-overlay`. Displays all credentials including **AB Tasty Identifier** and **VWO Authorization Key** (password field). The VWO API Key is intentionally not returned by `GET /api/config`. Saving updates both the server store and `localStorage`.

### Search

The nav search bar opens a full-screen overlay (`#search-overlay`) backed by the AB Tasty Search API. Key details:
- Client calls `GET /api/search?text=<query>&hitsPerPage=8` (proxied server-side to avoid CORS)
- Server calls `https://search-api.abtasty.com/search?index={abtId}_Catalog&text=...`
- Results show product image (`img_link`), title, and price from the AB Tasty catalog
- Clicking a result opens the product link in a new tab
- Debounced 300ms; Escape key closes; backdrop click closes
- JS: `openSearch()`, `closeSearch()`, `_doSearch()`, `_renderSearchHits()`

## Adding a New Feature Flag

Whenever a new flag is added to the codebase (in `resolveExperiments` in `server.js`, or evaluated via `vwoClientSide.getFlag` in `index.html`), it must also be created in VWO FME via the REST API. Add it to the `POST /api/setup-flags` handler in `server.js` following the same check-then-create pattern used for the `recommendations` flag:

1. Check whether the flag already exists in the list response before creating it.
2. Create it with `POST https://app.vwo.com/api/v2/accounts/current/features`.
3. Auth header is `token: <apiKey>` (not `Authorization: Bearer`). The `apiKey` must be decrypted first: `decrypt(c.apiKey)`.
4. Required body fields: `name`, `featureKey`, `featureType` (`"PERMANENT"` or `"TEMPORARY"`), and `variables` (each with `variableName`, `dataType`, and a non-empty `defaultValue`).
5. Valid `dataType` values: `"string"`, `"int"`, `"float"`, `"json"`.
6. The list endpoint returns a bare array; `limit` is capped at 25.

### API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | VWO client status (diagnostic) |
| `GET` | `/api/experiments` | Core endpoint — returns visitor's flag assignments |
| `POST` | `/api/events` | Ingest analytics events (placeholder forwarding) |
| `GET` | `/api/products` | List products (`?category=`, `?limit=`) |
| `GET` | `/api/products/:id` | Single product |
| `GET` | `/api/collections` | All collections |
| `GET` | `/api/config` | Visitor's credentials; accepts `?email=` for email-based lookup |
| `POST` | `/api/credentials` | Store encrypted credentials (keyed by email) |
| `DELETE` | `/api/credentials` | Clear stored credentials for this visitor's email |
| `POST` | `/api/verify-email` | Gate access via VWO `scDemoSite` flag |
| `POST` | `/api/check-theme` | Evaluate `demoTheme` flag with `usertheme` custom variable |
| `POST` | `/api/setup-flags` | Auto-create VWO flags via REST API |
| `GET` | `/api/search` | Proxy to AB Tasty Search API (`?text=`, `?hitsPerPage=`, `?page=`) |
| `GET` | `/vwo-sdk.js` | Serve VWO FME JS SDK |
| `GET` | `/*` | SPA fallback — serves `public/index.html` |

## `demoTheme` Flag

- **Flag key:** `demoTheme`
- **Variable:** `theme` (string)
- **Custom variable sent:** `usertheme` — value is `"canada"` (Canadian theme) or `"france"` (French theme)
- **VWO account:** the server-side account from `.env` (`VWO_SDK_KEY` / `VWO_ACCOUNT_ID`), not the visitor's own account
- **Current behaviour:** result logged to browser console (`enabled` + `theme` value) and server terminal; not yet applied to styling
- **To activate:** create the flag in the `.env` VWO account with a `theme` string variable and an active rollout rule

## Credential Encryption Details

Sensitive fields encrypted: `sdkKey`, `apiKey`, `recoToken`. Non-sensitive fields stored plain: `email`, `accountId`, `recoId`, `abtId`, `theme`.

Cipher: AES-256-GCM. Functions: `encrypt(text)` → JSON string `{ iv, tag, data }`; `decrypt(stored)` → plaintext or `null` on failure.

`ENCRYPTION_KEY` must be stable across restarts for decryption to work. Without it, a new ephemeral key is generated each cold start — `localStorage` restore still works (the server re-encrypts with the new key on the next `POST /api/credentials`), but any records written in a previous warm instance become unreadable.
