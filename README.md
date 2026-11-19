# ChaosSlip

ChaosSlip is a UBC hackathon project for live GTA challenge parlays: a streamer attempts a sequence of objectives before a shared timer runs out, while viewers follow progress and see the completes/fails pools in real time.

The current implementation includes a Next.js app, Supabase database and realtime subscriptions, an admin dashboard, a stream overlay, a signed game-event API with a simulator, email/password accounts, and verified Ethereum wallet linking on Sepolia. Bet transactions, smart contracts, payouts, and the GTA mod itself are not included yet. Betting remains disabled until a contract is implemented.

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
| `APP_URL` | Canonical app origin for wallet signatures and origin checks, also used by the simulator; use `http://localhost:3000` locally and your exact HTTPS origin on Vercel |

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

## Accounts and wallets

For an existing Supabase project, run [migration 002](supabase/migrations/002_accounts_wallets.sql) before using wallet linking. New projects already include it in `schema.sql`. Accounts use Supabase Auth's `auth.users`; verified wallet links and short-lived challenges are stored in separate private tables.

In Supabase Authentication, enable the Email provider and email confirmations. Configure your Site URL and redirect allowlist to include your app's `/account` URL (for example `http://localhost:3000/account` and your production HTTPS URL). Set `APP_URL` to the matching app origin in each environment. Preview deployments need their own matching origin and allowed email redirect URL.

1. Open `/account`, choose **Create an account**, and enter an email and password of at least eight characters.
2. Confirm your email using the link Supabase sends, then sign in if needed.
3. Use an installed Ethereum browser wallet, such as MetaMask, and choose **Connect and verify wallet**.
4. Approve account access and switching to Sepolia (chain ID `11155111`). Sign the ownership message.
5. The account page displays the verified wallet. Returning users can reconnect or verify a replacement wallet.

Signing this message does not create a transaction, transfer funds, or approve token spending. Wallet linking requires no test ETH. The implementation supports externally owned accounts through the browser's injected Ethereum provider (`window.ethereum`). WalletConnect, mobile deep links, smart-contract wallet signatures, and password recovery UI are not implemented.

The server validates the Supabase access token and confirmed email, generates a five-minute EIP-4361 message bound to the account and app origin, and verifies the wallet signature. Linking consumes the challenge atomically. Each account has one linked wallet, and each wallet can belong to only one account. A new challenge replaces that account's previous challenge. Client requests cannot write wallet links directly, and no private keys or seed phrases are requested or stored.

`npm test` includes real generated-key signature tests and HTTP authorization tests. [Wallet database assertions](supabase/tests/wallets.sql) verify replay prevention, expiration, cross-account uniqueness, rollback, and access restrictions. Run these SQL assertions in a test Supabase project; fixtures are rolled back. Actual email delivery and browser wallet approval still need a manual end-to-end check with your configured Supabase project.

The next betting milestone needs a Sepolia contract, its address and ABI, transaction submission and confirmation, verified event indexing into `slips`, and settlement. Linked wallet records alone do not authorize bets or prove a payment happened. Future Twitch/browser extension frontends can reuse the backend account and wallet logic, with platform-specific authentication and wallet connection work still required.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | List the 20 most recent sessions |
| `/admin` | Create and start sessions; manually resolve objectives |
| `/account` | Create an account, sign in/out, and link a verified Sepolia wallet |
| `/s/<session_id>` | Viewer page with timer, objectives, and pool totals |
| `/overlay/<session_id>` | Compact live stream overlay |

## API

The challenge endpoints below use `POST`. Admin endpoints require the `x-admin-password` header matching `ADMIN_PASSWORD`.

| Endpoint | Body / behavior |
| --- | --- |
| `/api/admin/sessions` | Create a session with `title`, `durationMinutes`, `lockAt`, and `legs` |
| `/api/admin/sessions/<id>/start` | Start an open session |
| `/api/admin/legs/<id>` | Resolve the active leg with `{"outcome":"done"}` or `{"outcome":"failed"}` |
| `/api/game-events` | Receive a signed game-event payload |
| `/api/sessions/<id>/expire` | Public trigger to expire a live session after its deadline; otherwise leaves it unchanged |

Account wallet endpoints require a Supabase access token in `Authorization: Bearer <token>`. `GET /api/wallet` returns the current account's linked wallet; `POST /api/wallet/challenge` accepts `{ "address": "0x..." }`; `POST /api/wallet/verify` accepts `{ "signature": "0x..." }`. POST requests also require the configured app origin. The server determines account identity from the token, not from request body fields.

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

Timestamps must be within 60 seconds of server time. Event logging and outcome application run in one database transaction. A successful retry with the same `event_id` and payload returns `duplicate: true` and the original session result without applying the outcome again. Reusing an ID with a different payload returns HTTP 409. Failed transactions do not consume the event ID, so the sender can retry the same payload with a fresh timestamp and signature. Historical events logged before the atomic-processing migration return HTTP 409 for manual review because their processing state is unknown. See [scripts/sim-events.mjs](scripts/sim-events.mjs) for a complete sender example.

## Database and session flow

| Table | Stores |
| --- | --- |
| `sessions` | Session timing, status, title, and a numeric ID reserved for chain integration |
| `legs` | Ordered objectives, parameters, and resolution status |
| `game_events` | Signed event payloads with unique event IDs |
| `slips` | Intended off-chain mirror of bets, including wallet, side, wei amount, and transaction hash |

Sessions move from `open` to `live`, then `won` or `lost`. Legs move from `pending` to `active`, then `done` or `failed`. Postgres functions serialize lifecycle changes by locking the session row.

Public clients can read sessions, legs, and slips. Writes use the server's service role client; lifecycle functions are restricted to that role. Realtime subscriptions refresh viewer data when sessions, legs, or slips change.

Pool totals are calculated from `slips` and displayed in ETH. Wallet connection and ownership verification are implemented; bet submission, chain indexing, and settlement are still pending.

## Commands and tests

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the local development server |
| `npm run build` | Build the production app |
| `npm start` | Serve the production build |
| `npm test` | Run the Node.js HMAC tests |
| `npm run sim -- <session_id> <done\|failed>` | Send a signed result for the active objective |

`npm test` covers signature verification and the HTTP handler: invalid JSON and payloads, rejected authentication, atomic RPC arguments, duplicate receipts, and error status mapping. These tests use a stub database client and need no credentials.

Database assertions live in [supabase/tests/game_events.sql](supabase/tests/game_events.sql). Run that file in the Supabase SQL editor against a test project after applying the schema. It creates temporary fixtures inside a transaction and rolls them back. It checks failed-event rollback and retry, session/leg ownership, objective order, duplicate receipts, event-ID conflicts, wins, failures, late outcomes, and legacy event handling. It does not test concurrent connections or browser behavior.

### Updating an existing Supabase project

Before deploying the updated event API, run [supabase/migrations/001_atomic_game_events.sql](supabase/migrations/001_atomic_game_events.sql) in the SQL editor. New projects get this function from `schema.sql` already; existing projects should use the migration instead of rerunning the full schema. The migration adds a processing receipt to `game_events` and the service-role-only `process_game_event` function.

For a manual retry check, send the same event ID and JSON payload twice, refreshing the signed timestamp on each request. Expect `duplicate: false` followed by `duplicate: true`, with only one objective transition. The simulator currently generates a new event ID each run, so two separate simulator runs are two different events.

For a production build, configure the same environment variables, then run `npm run build` followed by `npm start`.

## Markets

GTA VI is console-only, so the host resolves objectives from `/admin`; the game-event API stays for a future PC release. Each session gets several markets:

| Kind | Outcomes | Settled by |
| --- | --- | --- |
| `parlay` | Yes / No: every objective completed in time | Automatically when the session is won or lost |
| `leg` | Yes / No: one objective completed | Automatically when its objective is done or failed; objectives never reached are voided |
| `over_under` | Over / Under a half-point line, e.g. deaths o/u 2.5 | Host enters the final count |
| `multiple_choice` | 2–6 host-defined outcomes | Host picks the winner |

Existing projects run [migration 003](supabase/migrations/003_markets.sql); new projects get it from `schema.sql`. [supabase/tests/markets.sql](supabase/tests/markets.sql) checks locking, automatic settlement, voiding and host resolution. Admin endpoints: `POST /api/admin/markets/<id>/resolve` with `{"outcomeId"}` or `{"count"}`, `POST /api/admin/markets/<id>/count` with `{"current"}` for the overlay, and `POST /api/admin/markets/<id>/void`.

### Gemini market data

The home and viewer pages show read-only prices from [Gemini Predictions](https://www.gemini.com/predictions) for events matching `GEMINI_MARKET_SEARCH` (default `GTA`), and hide the panel when nothing matches. `GET /api/gemini/markets` serves the same list, cached for 60 seconds. ChaosSlip never places orders on Gemini: Gemini lists only its own regulated events, trading needs each user's own Gemini account, and it is available in the US only.

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
