# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**True North** is a Canadian-themed mock ecommerce store used as a demo platform for server-side feature experimentation with VWO (Visual Website Optimizer) Feature Management & Experimentation (FME), and Wingify Commerce (Search, Recommendations). It demonstrates zero-flicker A/B testing via server-side experiment resolution.

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
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL — set automatically by the Upstash Redis integration in the Vercel Marketplace. Required for cross-browser credential restore. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token — set automatically by the same integration. |
| `CATALOG_API_KEY` | Wingify Commerce Catalog API JWT — used for catalog integration. Scoped to `catalog_api`. |

## Architecture

### Backend (`src/server.js`)

Express REST API with server-side experiment resolution. Key flows:

1. **Visitor Identity** — Every request passes through middleware that assigns a UUID via an HTTP-only cookie (1-year TTL). This UUID is the stable identity for VWO bucketing.

2. **VWO FME SDK** — Initialized once at module load via `vwo-fme-node-sdk` (module-level `vwoReady` promise). The main integration point is `GET /api/experiments`, which resolves flag values (`hero_variant`, `promo_layout`, `enable_wishlist`) before the page renders, eliminating flicker.

3. **Deterministic Fallback** — If the VWO SDK is unavailable, a simple string hash maps visitor IDs to buckets 0–99 for consistent assignment without VWO.

4. **Credential Store** — Visitors store their own VWO + Wingify Commerce credentials during onboarding. Credentials are:
   - **Keyed by email address** (not by cookie/visitorId) so the same user is recognised across browsers and server restarts.
   - **Encrypted at rest**: `sdkKey`, `apiKey`, and `recoToken` are AES-256-GCM encrypted before writing; decrypted transparently on read.
   - **Persisted to disk** in two JSON files in `os.tmpdir()` (`tn-credentials.json`, `tn-visitor-email.json`), loaded on startup.
   - **Mirrored to Upstash Redis** (keys `creds:{email}` and `vemap:{visitorId}`) as the shared persistent store across all Vercel serverless instances. Redis is the cross-instance source of truth, resolved via the shared `_resolveEmailAndCreds()` helper, which is used by `GET /api/config`, `POST /api/setup-flags`, `GET /api/search`, and `GET /api/autocomplete` (`POST /api/verify-email` checks Redis directly for existence only). By default (`alwaysRefresh: true`, used by `/api/config` and `/api/setup-flags`) Redis is checked on every call and preferred over the instance-local cache, so a credential save on one instance is visible immediately on every other. `/api/search` and `/api/autocomplete` pass `alwaysRefresh: false` — as-you-type endpoints that fire on every keystroke — so Redis is only consulted when the local cache is completely empty (cold start), avoiding a round-trip per request.
   - **httpOnly cookie** (`tn_creds`, 1-year) set by the server on `POST /api/credentials` with plaintext credentials. Cookie restore middleware re-populates the in-memory store on cold starts without a Redis call, covering the same-browser case. Cookie is cleared on `DELETE /api/credentials`.
   - **Email-restore shortcut** — `POST /api/verify-email` returns `hasCredentials: true` when Redis has credentials for that email. The gate immediately fetches `GET /api/config?email=...` and skips all remaining steps, hiding the gate without re-entry.
   - `boot()` on the client calls `GET /api/config` directly (no localStorage read or silent POST needed).
   - The `visitorId` cookie is still used for VWO experiment bucketing, but credential lookup goes email → credentials.
   - `apiKey` (VWO REST API key) is never returned by `GET /api/config`.

5. **VWO REST API Integration** — `POST /api/setup-flags` auto-creates flags in VWO via the management REST API. Flags managed: `recommendations` (`PERMANENT`, variables `homepage_id`, `pdp_id`, `cart_id` — all `string`, default `"none"`) and `pricePromotion` (`PERMANENT`, variables `PromoBanner` `string` default `"false"` and `discountpercent` `int` default `0`).

6. **Theme Selection** — `POST /api/check-theme` evaluates the `demoTheme` flag using the server-side VWO client (`.env` credentials). Called during onboarding with a `usertheme` custom variable (`"canada"` or `"france"`). Returns `{ theme, isEnabled }` and logs both values server-side.

7. **Wingify Commerce Search Proxy** — `GET /api/search` proxies to `https://search-api.abtasty.com/search` to avoid browser CORS restrictions. Uses the visitor's stored `abtId` credential as the index (`{abtId}_Catalog`); falls back to a demo identifier if not set.

8. **Products & Collections** — Static data in `src/data.js` (8 products, 6 collections). `GET /api/products` supports `?category=` and `?limit=` filters.

### Frontend (`public/index.html`)

Single-file SPA (HTML + inline CSS + inline JS). No bundler or framework. The frontend:
- Calls `GET /api/experiments` on load to receive pre-resolved flag values
- Renders hero/promo variants based on the response
- Dynamically injects the VWO FME JavaScript SDK tag for client-side tracking
- Uses Playfair Display / DM Sans fonts with a Canadian red (`#C8102E`) / pine green / gold palette

### Onboarding Gate (`gateState`)

**Currently bypassed** — `boot()` always loads credentials for `david.halk@abtasty.com` and never calls `showGate()`. The gate code remains in place for when it is re-enabled.

8-step flow rendered by `buildGateHTML()` / `handleGateNext()`. Every step except `email` has a ← Back button. Navigation is driven by `GATE_BACK_MAP` and `gateBack()`.

| Step key | Collects | Notes |
|---|---|---|
| `email` | Email address | Verified against VWO `scDemoSite` flag |
| `theme` | Radio: Canadian (`canada`) / French (`france`) | Calls `/api/check-theme` on selection; logs `demoTheme` flag result immediately |
| `account-id` | VWO Account ID | Client-side SDK init |
| `sdk-key` | Feature Experimentation SDK Key | Client-side SDK init |
| `api-key` | VWO API Key | Used server-side by `/api/setup-flags` only; never returned by `/api/config`. Has note + Skip button |
| `reco-id` | Wingify Commerce Site ID | Stored as `recoId` |
| `reco-token` | Wingify Commerce API Key | Stored as `recoToken` |
| `abt-id` | Wingify Commerce Identifier | Same identifier used for Web Experimentation. Powers Search. Stored as `abtId`. Final step — triggers credential save and flag setup |

After the final step, `siteConfig` is updated in-memory, credentials are saved to the server store (disk + Redis), and the `tn_creds` httpOnly cookie is set.

### Manage Credentials Panel

Footer link opens `#creds-overlay`. **Only visible when `#admin` is appended to the URL** (e.g. `https://yoursite.com/#admin`). Displays all credentials including **Wingify Commerce Identifier** and **VWO Authorization Key** (password field). The VWO API Key is intentionally not returned by `GET /api/config`. Saving updates the server store (disk + Redis) and refreshes the `tn_creds` httpOnly cookie.

### Mock Login

A **Login** button in the top-right nav opens a modal with username + password fields. The password is never validated. On sign-in:
- `activeUserId` is set to the username in memory
- `localStorage` key `tn_vwo_user_id` is updated to the username
- All client-side `getFlag` calls use the username as the visitor ID
- `customVariables: { loggedin: true }` is included in the VWO user context

On sign-out, `tn_vwo_user_id` reverts to the server-assigned UUID (`siteConfig.visitorId`). The stored credentials in Manage Credentials are never affected.

**localStorage key:** `tn_vwo_user_id` — stores the current VWO SDK visitor ID. Seeded from the server UUID on first visit. Updated on login/logout.

### Search

The nav search bar drives two flows: a dropdown preview (autocomplete + hits) and a full search results page.

**Nav dropdown** — triggered by typing in the nav search input (200ms debounce):
- Two parallel requests fire on each keystroke, both cancelled via `AbortController` if another keystroke arrives before they resolve.
- `GET /api/autocomplete?text=<query>&hitsPerPage=5` → server proxies to `https://search-api.abtasty.com/autocomplete?client_id={abtId}&query=<query>`. **Required params are `client_id` and `query`** — sending `text` instead of `query` returns a 400. The `_Suggestions` index is populated from real user query history; it is empty on a fresh account, so suggestions will be an empty array until query history accumulates.
- `GET /api/search?text=<query>&hitsPerPage=3` → server proxies to search API for product hit previews.
- **Dropdown layout**: two-column (suggestions left, products right) when suggestions are present; collapses to single-column products-only when suggestions array is empty. Hidden on outside click, Escape, or Enter.
- "View all results" button and Enter both navigate to the full search results page (`state.page = 'search'`).

**Full search results page** — `buildSearch()` renders the shell; `_doSearch()` fetches and populates it:
- `GET /api/search?text=<query>&hitsPerPage=12&page=<n>&semanticRatio=1&facets=*&...` — `facets=*` requests all facet data. Server passes the raw query string through to `https://search-api.abtasty.com/search?index={abtId}_Catalog&...`.
- Results show product image (`img_link`), title, and price. Clicking opens `hit.link` in a new tab.
- **Facet sidebar**: rendered by `_renderFacets()` from `data.facets`. List facets → chip toggles; range facets → min/max inputs with Apply. Sidebar hidden (and layout collapses) when no facets returned.
- **Sort**: `_renderControls()` renders a sort dropdown (`price:asc`, `price:desc`, `name:asc`, `name:desc`, relevance).
- **Load more**: append mode — `_currentPage++`, `_doSearch(undefined, true)` merges new hits into `_accHits`.
- Filters use bracket notation: `filters[field][]=value` for list, `filters[price][0][operator]=>=&filters[price][0][value]=N` for range.

**Key JS functions**: `_bindNavSearch()`, `_doNavSearch()`, `_showNavDropdown()`, `_hideNavDropdown()`, `_viewAllSearch()`, `_buildSearchParams()`, `_doSearch()`, `_renderControls()`, `_renderFacets()`, `_renderAccHits()`, `_renderLoadMore()`.

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
| `GET` | `/api/search` | Proxy to Wingify Commerce Search API (`?text=`, `?hitsPerPage=`, `?page=`) |
| `GET` | `/api/autocomplete` | Proxy to AB Tasty Autocomplete API (`?text=`, `?hitsPerPage=`) |
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

`ENCRYPTION_KEY` must be **identical across all environments** (local, Preview, Production) because Upstash Redis is shared. If the key differs between environments, credentials written by one instance cannot be decrypted by another. Without it, a new ephemeral key is generated each cold start — same-browser cookie restore re-encrypts on the next `POST /api/credentials`, but Redis records from a previous key become unreadable.
