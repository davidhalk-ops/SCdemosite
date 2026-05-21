# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**True North** is a Canadian-themed mock ecommerce store used as a demo platform for server-side feature experimentation with VWO (Visual Website Optimizer) Feature Management & Experimentation (FME). It demonstrates zero-flicker A/B testing via server-side experiment resolution.

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
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM credential encryption (auto-generated if unset) |

## Architecture

### Backend (`src/server.js`)

Express REST API with server-side experiment resolution. Key flows:

1. **Visitor Identity** — Every request passes through middleware that assigns a UUID via an HTTP-only cookie (1-year TTL). This UUID is the stable identity for VWO bucketing.

2. **VWO FME SDK** — Initialized once on startup via `vwo-fme-node-sdk`. The main integration point is `GET /api/experiments`, which resolves flag values (`hero_variant`, `promo_layout`, `enable_wishlist`) for the visitor before the page renders, eliminating flicker.

3. **Deterministic Fallback** — If the VWO SDK is unavailable, a simple string hash maps visitor IDs to buckets 0–99 for consistent assignment without VWO.

4. **Multi-Account Credentials** — Visitors can store their own VWO account credentials (SDK key + account ID). These are encrypted with AES-256-GCM and stored per-visitor. Endpoints: `POST /api/credentials`, `GET /api/config`, `DELETE /api/credentials`.

5. **VWO REST API Integration** — `POST /api/setup-flags` auto-creates flags in VWO via the management REST API. The current flag is `recommendations` (key: `recommendations`, type: `PERMANENT`) with variables `homepage_id`, `pdp_id`, and `cart_id` (all `string`, default `"none"`).

6. **Theme Selection** — `POST /api/check-theme` evaluates the `demoTheme` flag using the server-side VWO client (`.env` credentials). Called during onboarding with a `usertheme` custom variable (`"canada"` or `"france"`). Returns `{ theme, isEnabled }` and logs both values server-side. Intended to drive branding/styling changes; currently wired to console output only.

7. **Products & Collections** — Static data in `src/data.js` (8 products, 6 collections). `GET /api/products` supports `?category=` and `?limit=` filters.

### Frontend (`public/index.html`)

Single-file SPA (HTML + inline CSS + inline JS). No bundler or framework. The frontend:
- Calls `GET /api/experiments` on load to receive pre-resolved flag values
- Renders hero/promo variants based on the response
- Dynamically injects the VWO FME JavaScript SDK tag for client-side tracking
- Uses Playfair Display / DM Sans fonts with a Canadian red (`#C8102E`) / pine green / gold palette

### Onboarding Gate (`gateState`)

7-step flow rendered by `buildGateHTML()` / `handleGateNext()`:

| Step key | Collects | Notes |
|---|---|---|
| `email` | Email address | Verified against VWO `scDemoSite` flag |
| `theme` | Radio: Canadian (`canada`) / French (`france`) | Calls `/api/check-theme` on selection; logs `demoTheme` flag result immediately |
| `account-id` | VWO Account ID | Client-side SDK init |
| `sdk-key` | Feature Experimentation SDK Key | Client-side SDK init |
| `api-key` | VWO API Key | Used server-side by `/api/setup-flags` only; never returned by `/api/config` |
| `reco-id` | AB Tasty Commerce Site ID | Stored as `recoId` |
| `reco-token` | AB Tasty Commerce API Key | Stored as `recoToken`; triggers credential save and flag setup on submit |

After the final step, `siteConfig` is updated in-memory so the "Manage Credentials" panel works in the same session without a page reload.

### Manage Credentials Panel

Footer link opens `#creds-overlay`. Displays all credentials including **VWO Authorization Key** (editable, password field). The VWO API Key is intentionally not returned by `GET /api/config` (server never exposes it), so the field will be blank for returning visitors after a server restart — they must re-enter it if they need to re-run flag setup.

## Adding a New Feature Flag

Whenever a new flag is added to the codebase (in `resolveExperiments` in `server.js`, or evaluated via `vwoClientSide.getFlag` in `index.html`), it must also be created in VWO FME via the REST API. Add it to the `POST /api/setup-flags` handler in `server.js` following the same check-then-create pattern used for the `recommendations` flag:

1. Check whether the flag already exists in the list response before creating it.
2. Create it with `POST https://app.vwo.com/api/v2/accounts/current/features`.
3. Auth header is `token: <apiKey>` (not `Authorization: Bearer`).
4. Required body fields: `name`, `featureKey`, `featureType` (`"PERMANENT"` or `"TEMPORARY"`), and `variables` (each with `variableName`, `dataType`, and a non-empty `defaultValue`).
5. Valid `dataType` values: `"string"`, `"int"`, `"float"`, `"json"`.
6. The list endpoint returns a bare array; `limit` is capped at 25.

### API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/experiments` | Core endpoint — returns visitor's flag assignments |
| `POST` | `/api/events` | Ingest analytics events (placeholder forwarding) |
| `GET` | `/api/products` | List products (`?category=`, `?limit=`) |
| `GET` | `/api/products/:id` | Single product |
| `GET` | `/api/collections` | All collections |
| `GET` | `/api/config` | Visitor's VWO credentials for client-side SDK |
| `POST` | `/api/credentials` | Store encrypted VWO credentials |
| `DELETE` | `/api/credentials` | Clear stored credentials |
| `POST` | `/api/verify-email` | Gate access via VWO `scDemoSite` flag |
| `POST` | `/api/check-theme` | Evaluate `demoTheme` flag with `usertheme` custom variable; uses `.env` VWO client |
| `POST` | `/api/setup-flags` | Auto-create VWO flags via REST API |
| `GET` | `/vwo-sdk.js` | Serve VWO FME JS SDK |
| `GET` | `/*` | SPA fallback — serves `public/index.html` |

## `demoTheme` Flag

- **Flag key:** `demoTheme`
- **Variable:** `theme` (string)
- **Custom variable sent:** `usertheme` — value is `"canada"` (Canadian theme) or `"france"` (French theme)
- **VWO account:** the server-side account from `.env` (`VWO_SDK_KEY` / `VWO_ACCOUNT_ID`), not the visitor's own account
- **Current behaviour:** result logged to browser console (`enabled` + `theme` value) and server terminal; not yet applied to styling
- **To activate:** create the flag in the `.env` VWO account with a `theme` string variable and an active rollout rule
