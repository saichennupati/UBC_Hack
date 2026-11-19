# ChaosSlip

ChaosSlip is a UBC hackathon project for live GTA challenge parlays: a streamer attempts a sequence of objectives before a shared timer runs out, while viewers follow progress and see the completes/fails pools in real time.

The current implementation includes a Next.js app, Supabase database and realtime subscriptions, an admin dashboard, a stream overlay, and a signed game-event API with a simulator. Wallet betting, smart contracts, payouts, and the GTA mod itself are not included yet. The wallet button is currently disabled.

## Features

- Create sessions with a title, duration, betting cutoff, and 1–10 ordered objectives.
- Support mission-first-try, survive-pursuit, and reach-location objective types. Location objectives store `x`, `y`, `z`, and a positive `radius`.
- Start sessions and manually mark the active objective as done or failed from the admin dashboard.
- Show live session status, countdowns, objective progress, and pool totals through Supabase Realtime.
- Provide a compact overlay for a streaming browser source.
- Receive HMAC-signed game events and record their payloads in an audit table.
- Simulate game events without running GTA.

## Stack

- Next.js 15.5.4 with the App Router
- React 19.1.0 and JavaScript
- Supabase Postgres, row-level security, and Realtime
- Node.js crypto for HMAC-SHA256 signatures
- Plain CSS for the viewer, admin, and overlay interfaces

## Local setup

Use Node.js 20.6 or newer and npm. The simulator uses Node's `--env-file` option. You also need a Supabase project.

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/saichennupati/UBC_Hack.git
   cd UBC_Hack
   npm install
   ```

   If you already have the repository locally, run `npm install` from its folder.

2. Run [supabase/schema.sql](supabase/schema.sql) in your Supabase project's SQL editor. It creates the tables, read policies, Realtime publication entries, and session lifecycle functions. Run it once on a fresh project; the publication statement is not safe to rerun unchanged if the tables are already in the publication.

3. Create your local environment file:

   ```bash
   cp .env.example .env.local
   ```

4. Fill in these values:

   | Variable | Purpose |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public Supabase API key used for reads and Realtime |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role key used by API routes |
   | `ADMIN_PASSWORD` | Shared password entered in the admin dashboard |
   | `MOD_SHARED_SECRET` | Shared secret used to sign game events |
   | `APP_URL` | Simulator's target app URL; defaults to `http://localhost:3000` |

   Keep the service role key, admin password, and mod secret private. `.env.local` is ignored by Git; only the two `NEXT_PUBLIC_` values are intended for browser use.

5. Start the development server:

   ```bash
   npm run dev
   ```

   Open [localhost:3000](http://localhost:3000).

## Run a demo

1. Open `/admin` and enter the `ADMIN_PASSWORD` from `.env.local`.
2. Create a session with a duration, betting cutoff, and objectives. Fill in coordinates and radius for any reach-location objective, or remove that objective for a simpler demo.
3. Open the session's **Viewer page** and **Overlay** links. Use `/overlay/<session_id>` as a browser-source URL in your streaming software.
4. Click **Start session**. This closes betting immediately, starts the timer, and activates the first objective.
5. Use **Mark leg done** / **Mark leg failed**, or send a signed event from a second terminal:

   ```bash
   npm run sim -- <session_id> done
   npm run sim -- <session_id> failed
   ```

   Replace `<session_id>` with the UUID shown on the admin dashboard. Each simulator invocation finds the currently active leg and sends one result. Use `done` repeatedly to progress through a successful session; `failed` ends it in a loss.

All objectives must succeed in order to win. A failed objective or an outcome received after the deadline loses the session. Viewer and overlay pages request expiration when their countdown reaches zero; there is no background expiration worker in this repository.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | List the 20 most recent sessions |
| `/admin` | Create and start sessions; manually resolve objectives |
| `/s/<session_id>` | Viewer page with timer, objectives, and pool totals |
| `/overlay/<session_id>` | Compact live stream overlay |

## API

All endpoints below use `POST`. Admin endpoints require the `x-admin-password` header matching `ADMIN_PASSWORD`.

| Endpoint | Body / behavior |
| --- | --- |
| `/api/admin/sessions` | Create a session with `title`, `durationMinutes`, `lockAt`, and `legs` |
| `/api/admin/sessions/<id>/start` | Start an open session |
| `/api/admin/legs/<id>` | Resolve the active leg with `{"outcome":"done"}` or `{"outcome":"failed"}` |
| `/api/game-events` | Receive a signed game-event payload |
| `/api/sessions/<id>/expire` | Public trigger to expire a live session after its deadline; otherwise leaves it unchanged |

### Game-event format

```json
{
  "event_id": "unique-event-id",
  "session_id": "session-uuid",
  "leg_id": "active-leg-uuid",
  "outcome": "done",
  "detail": "optional event context"
}
```

Send `Content-Type: application/json` and these headers:

- `x-timestamp`: Unix time in whole seconds.
- `x-signature`: Hex HMAC-SHA256 using `MOD_SHARED_SECRET` over `${timestamp}.${body}`, where `body` is the exact raw JSON string sent.

Timestamps must be within 60 seconds of server time. Repeated `event_id` values return `{"duplicate":true}`. The audit insert happens before outcome application, so that duplicate response confirms the event was logged, not necessarily that its outcome was successfully applied. See [scripts/sim-events.mjs](scripts/sim-events.mjs) for a complete sender example.

## Database and session flow

| Table | Stores |
| --- | --- |
| `sessions` | Session timing, status, title, and a numeric ID reserved for chain integration |
| `legs` | Ordered objectives, parameters, and resolution status |
| `game_events` | Signed event payloads with unique event IDs |
| `slips` | Intended off-chain mirror of bets, including wallet, side, wei amount, and transaction hash |

Sessions move from `open` to `live`, then `won` or `lost`. Legs move from `pending` to `active`, then `done` or `failed`. Postgres functions serialize lifecycle changes by locking the session row.

Public clients can read sessions, legs, and slips. Writes use the server's service role client; lifecycle functions are restricted to that role. Realtime subscriptions refresh viewer data when sessions, legs, or slips change.

Pool totals are calculated from `slips` and displayed in ETH. There is currently no wallet connection, bet submission endpoint, chain indexer, or settlement implementation to populate and settle those bets.

## Commands and tests

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the local development server |
| `npm run build` | Build the production app |
| `npm start` | Serve the production build |
| `npm test` | Run the Node.js HMAC tests |
| `npm run sim -- <session_id> <done\|failed>` | Send a signed result for the active objective |

The existing tests cover valid signatures, body tampering, incorrect secrets, stale timestamps, and missing or malformed signatures. They do not require Supabase credentials. Database, API, and browser integration tests are not included.

For a production build, configure the same environment variables, then run `npm run build` followed by `npm start`.

## Project structure

```text
app/                    Next.js pages, API routes, and global styles
components/             Session view, overlay, and objective list
lib/                    Supabase clients, auth, signatures, validation, live hooks
scripts/sim-events.mjs   Signed game-event simulator
supabase/schema.sql     Tables, policies, Realtime setup, lifecycle functions
test/hmac.test.mjs       Signature verification tests
.env.example            Environment variable template
```

The root `app.js` is currently empty; the application entry points are in `app/`.
