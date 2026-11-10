# Swipeproof

Scores short-form video hooks, scripts and clips, and gives a specific change for every weak moment.

A React front end, an Express API and a SQLite database, with accounts and a server-side video pipeline.

## Quick start

Requires Node 22 or newer (the SQLite driver needs it).

```bash
npm install
npm run dev
```

- Site: http://localhost:5173
- API: http://localhost:3001/api/health

The database is created, migrated and seeded on first start. Vite proxies `/api` to the API in development.

### Turning on full video analysis

Full analysis runs on the server and has three layers. Each one switches on by itself when its requirement is met, and the server prints which are on at startup.

| Layer | Needs | Without it |
| --- | --- | --- |
| Picture: frames, cuts, format | `ffmpeg` and `ffprobe` installed | Only the in-browser quick check is offered |
| Speech: transcript, spoken hook and script scores | `OPENAI_API_KEY` | Reports cover the picture only |
| Coach notes: written feedback | `ANTHROPIC_API_KEY` | Reports have scores and fixes, no notes |

1. Install ffmpeg. On a Mac: `brew install ffmpeg`. On Ubuntu: `sudo apt install ffmpeg`.
2. Copy `.env.example` to `.env` and add the keys you have.
3. Restart `npm run dev`.

To try the whole flow with no keys, put `AI_PROVIDER=demo` in `.env`. The transcript and coach notes are then canned sample text, and reports label them as demo text.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API with reload on :3001 and Vite on :5173 |
| `npm test` | Scoring, API, account and pipeline tests. Pipeline tests skip themselves if ffmpeg is missing. |
| `npm run typecheck` | Strict TypeScript check for `web` and `server` |
| `npm run build` | Builds the front end to `web/dist` and bundles the API to `server/dist` |
| `npm start` | Runs the built API, which also serves the built front end |
| `npm run seed` | Reloads posts and site content from `server/seed/content.json` |

## Production run

```bash
npm ci
npm run build
NODE_ENV=production PORT=8080 DATA_DIR=/var/lib/swipeproof TRUST_PROXY=1 npm start
```

One Node process serves both the site and the API. Put it behind a reverse proxy that terminates TLS and forwards the original `Host` header, and keep `DATA_DIR` on a persistent disk. `.env.example` lists every setting.

## Layout

```
shared/               Pure TypeScript used by both sides
  engine.ts           Hook, script and link scoring. No I/O.
  video.ts            Visual scoring from sampled frames. Same rules in the browser and on the server.
  validate.ts         Form rules. The browser uses them for instant feedback, the API enforces them.
server/
  src/app.ts          Express app factory: routes, ownership rules, uploads, error handling
  src/auth.ts         Password hashing, sessions, sign-up, log-in, account deletion
  src/db.ts           SQLite schema as numbered migrations, seed loader
  src/pipeline/       ffmpeg.ts (frames, audio), providers.ts (speech to text, feedback),
                      analyze.ts (one video, start to finish), jobs.ts (background queue)
  seed/content.json   Posts, plans, FAQ, platform guides
  test/               API, account and pipeline tests (Vitest and Supertest)
web/
  src/pages/          One file per area of the site
  src/components/     Layout, report card, form fields
  src/lib/api.ts      Typed API client
  src/lib/video.ts    In-browser frame sampling for the quick check
```

## How accounts work

- Email and password. Passwords are hashed with scrypt and a per-user salt.
- A login is a random token in an `HttpOnly`, `SameSite=Lax` cookie. Only the token's SHA-256 is stored, and sessions last 30 days.
- Before signing in, a browser is known by a random id it sends as `x-client-id`. Signing up or logging in moves that browser's reports and form entries onto the account.
- Signed-in users see their account's rows. Anonymous browsers see only unclaimed rows with their id.
- Log-in attempts are limited to 10 per 15 minutes for each address and email. Sign-ups are limited to 5 an hour per address.
- State-changing requests whose `Origin` is another site are refused.
- An account can be deleted from the account page, which removes its reports.

## How a full analysis runs

1. The signed-in user uploads a video (200 MB and 5 minutes by default).
2. The file is saved under `DATA_DIR/uploads` with a random name and a background job starts. The browser polls the job.
3. `ffprobe` reads length and frame size. `ffmpeg` samples the same moments the quick check does, and `shared/video.ts` scores them.
4. If a speech provider is set and the video has sound, the audio is extracted and transcribed. The transcript is scored with the hook and script rules, using the real speaking pace so timecodes match the recording.
5. If a feedback provider is set, eight small stills, the transcript and the scores go to the model, which returns a summary and up to four fixes.
6. The report is saved and the upload is deleted, whether the job succeeded or failed. Uploads left by a crash are removed at the next start.

A failure in step 4 or 5 does not fail the job: the report is saved without that layer.

## API

All routes are under `/api`. `•` needs `x-client-id` or a login. `★` needs a login.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/capabilities` | Which analysis layers are on, and the limits |
| GET | `/content`, `/posts`, `/posts/:slug` | Site content and articles |
| POST | `/auth/signup`, `/auth/login`, `/auth/logout` | Accounts |
| GET | `/auth/me` | The signed-in user, or null |
| DELETE ★ | `/auth/account` `{ password }` | Delete the account and its reports |
| POST • | `/reports/hook`, `/reports/script` `{ text }` | Score and save |
| POST • | `/reports/video-link` `{ url }` | Save a simulated report for a supported link |
| POST • | `/reports/video-upload` | Save a quick check computed in the browser |
| GET, DELETE • | `/reports`, `/reports/:id` | List, read, delete |
| POST ★ | `/analyses` (multipart, field `video`) | Start a full analysis. Returns a job. |
| GET ★ | `/analyses/:id` | Job status, stage and the report id when done |
| GET • | `/me` | Stored plan, affiliate code and waiting list status |
| POST • | `/contact`, `/waitlist`, `/affiliates`, `/checkout` | Validated and stored in `submissions` |

Validation failures return `400` with `{ message, errors: { field: message } }`.

## What is real and what is a placeholder

Real:

- Accounts, sessions and per-account libraries
- Hook and script scoring
- Quick video check in the browser, and full analysis on the server
- Library, article search and every form, stored in SQLite

Placeholders, each tied to a later step:

| Placeholder | Where | Replaced in |
| --- | --- | --- |
| Link reports use sample findings | `simulateUrlReport` in `shared/engine.ts` | Step 5, link handling |
| Checkout records a plan and charges nothing. Plans do not gate features yet. | `/api/checkout` | Step 6, payments |
| Contact, waiting list and affiliate entries are stored but nothing is sent or tracked | `submissions` table | Step 7 |
| No password reset or email verification | `server/src/auth.ts` | Step 7, needs email sending |
| Legal page is draft text | `web/src/pages/Static.tsx` | Step 8 |

## Known gaps before real traffic

- **The AI calls have not been run against the live services.** They compile against the official client libraries and are tested with stand-ins. Run one real analysis with your own keys before relying on them, and check the model names in `.env.example` are still current.
- The scoring rules are reasoned guesses. They have not been checked against real retention data.
- Uploads sit on local disk and jobs run inside the web process, one at a time. Move to object storage and a separate worker before heavy use.
- Rate limits and the job queue live in memory, so they reset on restart and assume one server.
- Sign-up reveals whether an email already has an account. Email verification in step 7 removes the need for that.
- The `submissions` table holds names and emails. Decide on retention and access before collecting real ones.
- SQLite suits one server. Move to Postgres if you need more than one instance.
- `.npmrc` turns off dependency install scripts so the SQLite driver uses its prebuilt binary. If you add a dependency that needs an install script, run it by hand.
- No front-end component tests yet. The API, accounts, pipeline and scoring are covered.
