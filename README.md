# Swipeproof

Scores short-form video hooks, scripts and clips, and gives a specific change for every weak moment.

This repo is step 2 of the production plan: the single-page demo split into a React front end, an Express API and a SQLite database.

## Quick start

Requires Node 22 or newer (the SQLite driver needs it).

```bash
npm install
npm run dev
```

- Site: http://localhost:5173
- API: http://localhost:3001/api/health

The database is created and seeded on first start. Vite proxies `/api` to the API in development.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API with reload on :3001 and Vite on :5173 |
| `npm test` | Unit tests for the scoring engine and API tests against an in-memory database |
| `npm run typecheck` | Strict TypeScript check for `web` and `server` |
| `npm run build` | Builds the front end to `web/dist` and bundles the API to `server/dist` |
| `npm start` | Runs the built API, which also serves the built front end |
| `npm run seed` | Reloads posts and site content from `server/seed/content.json` |

## Production run

```bash
npm ci
npm run build
PORT=8080 DATABASE_PATH=/var/lib/swipeproof/swipeproof.db npm start
```

One Node process serves both the site and the API. Put it behind a reverse proxy that terminates TLS, and keep the SQLite file on a persistent disk. See `.env.example` for the two settings.

## Layout

```
shared/            Pure TypeScript used by both sides
  engine.ts        Hook, script and link scoring. No I/O.
  validate.ts      Form rules. The browser uses them for instant feedback, the API enforces them.
server/
  src/app.ts       Express app factory: routes, validation, error handling
  src/db.ts        SQLite schema, seed loader
  src/index.ts     Process entry point
  seed/content.json  Posts, plans, FAQ, platform guides
  test/api.test.ts API tests (Vitest and Supertest)
web/
  src/pages/       One file per area of the site
  src/components/  Layout, report card, form fields
  src/lib/api.ts   Typed API client
  src/lib/video.ts In-browser frame sampling for uploaded videos
```

## API

All routes are under `/api`. Routes marked with a dot need an `x-client-id` header (the web client sends one automatically).

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/content` | Plans, FAQ, tools, steps, platform guides |
| GET | `/posts?q=&category=&page=` | Search, filter and page articles |
| GET | `/posts/:slug` | One article with older and newer links |
| POST • | `/reports/hook` `{ text }` | Score a hook and save the report |
| POST • | `/reports/script` `{ text }` | Score a script and save the report |
| POST • | `/reports/video-link` `{ url }` | Save a simulated report for a supported link |
| POST • | `/reports/video-upload` | Save a report computed in the browser |
| GET • | `/reports`, `/reports/:id` | List or read your reports |
| DELETE • | `/reports`, `/reports/:id` | Clear or delete |
| GET • | `/me` | Stored plan, affiliate code and waiting list status |
| POST • | `/contact`, `/waitlist`, `/affiliates`, `/checkout` | Validated and stored in `submissions` |
| DELETE • | `/waitlist`, `/affiliates` | Withdraw |

Validation failures return `400` with `{ message, errors: { field: message } }`.

## What is real and what is a placeholder

Real:

- Hook and script scoring, run on the server and saved
- Uploaded video checks. Frames are sampled in the browser, so the file never leaves the device. Only the scores are sent.
- Library, article search and every form, stored in SQLite

Placeholders, each tied to a later step:

| Placeholder | Where | Replaced in |
| --- | --- | --- |
| Anonymous `x-client-id` instead of accounts | `web/src/lib/api.ts`, `clientId()` in `server/src/app.ts` | Step 3, accounts |
| Link reports use sample findings | `simulateUrlReport` in `shared/engine.ts` | Step 4 and 5, server pipeline |
| Upload scores are computed by the client and only shape-checked | `parseVideoReport` in `server/src/app.ts` | Step 4, server pipeline |
| Checkout records a plan and charges nothing | `/api/checkout` | Step 6, payments |
| Contact, waiting list and affiliate entries are stored but nothing is sent or tracked | `submissions` table | Step 7 |
| Legal page is draft text | `web/src/pages/Static.tsx` | Step 8 |

## Known gaps before real traffic

- No rate limiting or abuse protection on the API
- No accounts, so anyone who copies a client id can read that library
- The `submissions` table holds names and emails. Decide on retention and access before collecting real ones.
- SQLite suits one server. Move to Postgres if you need more than one instance.
- `.npmrc` turns off dependency install scripts so the SQLite driver uses its prebuilt binary. If you add a dependency that needs an install script, run it by hand.
- No front-end component tests yet. The API and engine are covered.
