# 🍁 True North — AB Tasty Commerce Demo

A Canadian-themed mock ecommerce store with a Node/Express backend,
ready for server-side feature experimentation.

## Project Structure

```
truenorth-node/
├── public/
│   └── index.html        # Frontend (single-page app)
├── src/
│   ├── server.js         # Express server + experiment logic
│   └── data.js           # Product & collection data
├── .env.example
└── package.json
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env

# 3. Run in development (auto-restarts on changes)
npm run dev

# 4. Or run in production
npm start
```

Server starts at http://localhost:3000

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/experiments` | Variation assignments for the current visitor |
| POST | `/api/events` | Track analytics events |
| GET | `/api/products` | All products (supports `?category=` and `?limit=`) |
| GET | `/api/products/:id` | Single product |
| GET | `/api/collections` | All collections |

## Hooking Up AB Tasty Server-Side SDK

1. Install the SDK:
   ```bash
   npm install @flagship.io/js-sdk
   # or whatever AB Tasty's current server-side package is
   ```

2. Add your credentials to `.env`:
   ```
   ABTASTY_ENV_ID=your_environment_id
   ABTASTY_API_KEY=your_api_key
   ```

3. Replace the `resolveExperiments()` stub in `src/server.js` with real SDK calls.

4. The `/api/experiments` endpoint already returns assignments to the frontend —
   the client can read these before rendering to apply the right variation with zero flicker.

## Deployment

### Railway (recommended — free tier, one command)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Render
- Connect your GitHub repo at render.com
- Build command: `npm install`
- Start command: `npm start`
- Add env vars in the dashboard

### Heroku
```bash
heroku create truenorth-demo
git push heroku main
```

### Fly.io
```bash
fly launch
fly deploy
```

All of these will auto-detect Node and set `NODE_ENV=production`.
Make sure to set your `.env` variables in each platform's dashboard.
