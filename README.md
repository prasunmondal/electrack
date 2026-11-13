# WBSEDCL Bill Tracker

Fetches the latest WBSEDCL bills for the configured consumers, extracts readings and amounts, shows a bill split between two people, and lets you download/share a merged PDF or a per-person statement image.

The backend opens each WBSEDCL short link in headless Chromium, selects English, clicks **Get Bill**, captures the PDF, and parses it.

## Architecture

- **Frontend** (`frontend/`): static HTML/CSS/JS. Fetches each bill with its own API call (2 at a time, up to 3 attempts each), keeps the PDFs in the browser, merges them client-side (pdf-lib), and draws the statement images on a canvas.
- **API** (`backend/src/api.js`): stateless handlers shared by both runtimes:
  - **Local / Docker:** Express server (`backend/src/server.js`) with the full `playwright` package.
  - **Vercel:** serverless functions in `api/` with `playwright-core` + `@sparticuz/chromium`.
- **Storage:** none. Nothing is kept on the server between requests.

## Included consumers

Configured in `backend/src/config.js`:

| Consumer ID | Bill URL |
|---|---|
| 101310436 | https://s.wbsedcl.in/U/c?GFdvN3%E0%A5%A4 |
| 101256487 | https://s.wbsedcl.in/U/c?GcFyAa%E0%A5%A4 |
| 164078438 | https://s.wbsedcl.in/U/c?RGWNMo%E0%A5%A4 |
| 164216951 | https://s.wbsedcl.in/U/c?R21IKm%E0%A5%A4 |

The bill split rules (shared vs own connections, labels) are in `SPLIT` at the top of `frontend/app.js`.

## Run locally (Windows)

Requirements: Node.js 20+. Double-click `run-local.cmd` (or run `.\run-local.cmd`). It stops anything on ports 3000/8080, installs dependencies on first run, starts the API (:3000) and the page (:8080) in their own windows, and opens http://localhost:8080.

Manual equivalent:

```bash
cd backend && npm install && npx playwright install chromium && cp .env.example .env && npm start
cd frontend && npx http-server -p 8080 -c-1
```

## Deploy to Vercel

The repo root is a ready-to-deploy Vercel project (`vercel.json`, root `package.json`, `api/`):

- `frontend/` is served as the static site; `api/*.js` become functions on the same domain (so `config.js` needs no URL).
- Functions run in Mumbai (`bom1`), close to WBSEDCL. `api/fetch-bill.js` has `maxDuration: 60`; one bill normally takes 5–10 s.

Steps:

1. Push this folder to a **private** GitHub repo, then in Vercel: **Add New → Project →** import the repo. Leave the framework as **Other** and the root directory as the repo root. (Or run `npx vercel deploy` from this folder.)
2. In **Settings → Environment Variables**, add `API_KEY` = a long random secret. The page asks for it once per browser and remembers it; it is never stored in the code.
3. Optionally turn on **Settings → Deployment Protection** so only you (logged in to Vercel) can open the site.
4. Deploy, open the URL, click **Fetch all bills**.

Version pinning: `playwright-core@1.63.0` and `@sparticuz/chromium@153.0.0` both target Chromium 153. Upgrade them together. The local `backend/` and the `Dockerfile` are pinned to Playwright 1.63.0 too.

## Other hosts (Docker)

`backend/Dockerfile` runs the Express API on any container host (Render, Railway, Fly.io). Serve `frontend/` separately and set `API_BASE_URL` in `frontend/config.js` to the API's URL, plus `FRONTEND_ORIGIN` on the API to the page's origin (CORS).

## Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `API_KEY` | both | empty (no auth) | Required `x-api-key` for `/api/consumers` and `/api/fetch-bill` |
| `NAVIGATION_TIMEOUT_MS` / `DOWNLOAD_TIMEOUT_MS` | both | `20000` | Per-attempt timeouts while scraping |
| `PORT`, `FRONTEND_ORIGIN` | local/Docker | `3000`, `http://localhost:8080` | Express port and allowed CORS origin(s) |

## API

- `GET /api/health`
- `GET /api/consumers` → `[{ consumerId }]`
- `POST /api/fetch-bill` with `{ "consumerId": "101310436" }` → parsed fields (name, readings, units, amounts before/after rebate, bill date) plus `pdfBase64`

## How the extraction works

1. Navigate to the consumer's short URL, select English, click **Get Bill**.
2. Capture the PDF download (falling back to the PDF response or a PDF link).
3. Parse the PDF text: name, previous/present reading, units, "Total Amount Payable at a time within 1st Due date" (before rebate), "Amount payable at a time through e-Payment within 1st Due date" (after rebate), billing date. Amounts are rounded up to whole rupees.

If WBSEDCL changes its page or PDF layout, update `backend/src/wbsedcl.js` / `backend/src/parser.js`. Fields that cannot be identified come back as `null` and the row is marked "Check PDF".

## Privacy

The bills contain names, addresses and payment details. Keep the repo private, set `API_KEY`, and preferably enable Vercel Deployment Protection.
