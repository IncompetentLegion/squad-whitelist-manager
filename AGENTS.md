# AGENTS.md

Last analyzed: 2026-04-24
Last updated: 2026-04-24

---

## Section 1: Overview

### What This Is

Squad Whitelist Manager is a web-based admin panel for managing reserved slots (whitelist) on Squad game servers. It handles clan-based player organization, expiry tracking, and an automated seeding reward system that grants temporary whitelist slots to players who help seed the server.

### Key Features

- **Clan management** - Create clans with tags and player limits. Assign managers to clans.
- **Player whitelist** - Add/remove players by 17-digit Steam ID. Optional expiry dates and notes. Players belong to clans or are standalone.
- **Role-based access** - Two roles: `admin` (full access) and `manager` (can only manage their own clan's players).
- **Seeding rewards** - Automatic tracking via SquadJS plugin. Players earn points for seeding; when threshold is hit, they get a temporary whitelist slot.
- **Public leaderboard** - `/seeding` shows seeding progress, lifetime stats, reward status, and clan rankings. Can be disabled via API settings.
- **Whitelist output** - Plain-text endpoint at `/whitelist` (optionally `/<key>`) in Squad `RemoteAdminListHosts` format.
- **Invite system** - Admins generate invite links for new managers (or admins). Links expire in 7 days.
- **Import tool** - Bulk import from existing Squad whitelist files.
- **API management** - Configure whitelist key and seeding API key from admin panel.

### Architecture at a Glance

- **Backend**: Node.js + Express, server-side rendered EJS templates with `express-ejs-layouts`.
- **Database**: `sql.js` (pure JavaScript SQLite, no native compilation). Persisted to a single `.db` file on disk. Writes are debounced (100ms) and also triggered on process exit/SIGINT/SIGTERM.
- **Frontend**: Minimal vanilla JS + custom CSS (no framework). All UI is server-rendered HTML with EJS partials. Flash messages handled via query params and server-side rendering.
- **Auth**: Session cookies (30-day expiry, httpOnly, lax sameSite). CSRF protection on all POSTs. Login rate limiting (5 attempts per 60 seconds per IP).
- **SquadJS Integration**: A plugin (`squadjs-plugin/whitelist-seeding.js`) POSTs online players every 60 seconds to `/seeding/report/<key>`. On player connect, it fetches progress and sends an RCON `AdminWarn`.

### How Data Flows

1. **Whitelist output** (`/whitelist`): Aggregates active players + active seeding rewards into Squad `Admin=` format. Cached for 60 seconds; invalidated on player/reward changes.
2. **Seeding tracking**: SquadJS plugin sends player list. Server checks player count against min/max. If within range, increments `seeding_points.points` and `lifetime_points`. When `points >= points_needed`, creates a `seeding_rewards` entry with expiry and resets points.
3. **Play time tracking**: When player count is >= `max_players`, increments `seeding_points.play_minutes` instead of seeding points.
4. **Cleanup**: Every 60 seconds, expired players, expired seeding rewards, and expired sessions are purged.

### Entry Points

- Web UI: `http://host:36419/` (port configurable via `PORT` env var)
- First boot redirects to `/setup` to create the initial admin account (user ID 1 is protected from deletion).
- Squad server consumes whitelist at `http://host:36419/whitelist` (or `/<key>` if protected).

### Agent Quick Start

If you are starting from no prior context, read these files first:

- `server.js` - app wiring, route mounting, database initialization, and direct-run listener startup.
- `src/db.js` - schema, migrations, persistence, and all database access functions.
- `src/auth.js` - auth middleware, CSRF, login rate limiting, username/date validation helpers.
- The relevant file in `src/routes/` - route behavior is intentionally kept close to UI actions.
- The matching EJS view in `views/` - forms, CSRF fields, and rendered data expectations.
- `src/utils.js` - whitelist generation cache, cleanup, and seeding report timestamp helpers.
- `tests/helpers.js` plus the matching `tests/*.test.js` file - preferred test setup and request patterns.

Useful commands:

```sh
npm install
npm start
npm run dev
npm test
```

There is no build step and no frontend bundler. Do not edit generated/runtime database files (`*.db`, including `whitelist.db` and `tests/test.db`).

### Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| `PORT` | `36419` | Server port |
| `DB_PATH` | `./whitelist.db` | SQLite file path |
| `NODE_ENV` | none | Set to `production` to enable secure cookies |

---

## Section 2: Technical Details

### File Structure

```
server.js                 # Express app setup, middleware, routes mounting
docker-compose.yml        # Single service, persists DB in named volume, port 36419
Dockerfile                # node:22-alpine, npm ci --omit=dev, DB_PATH=/data/whitelist.db
src/
  db.js                   # sql.js wrapper: schema init, all query functions, save logic
  auth.js                 # Middleware: requireAuth, requireAdmin, CSRF, rate limiting, helpers
  utils.js                # Whitelist text generation, cache invalidation, cleanup runner
  routes/
    auth.js               # /setup, /login, /logout, /password, /invite/:token
    dashboard.js          # GET / (role-based dashboard rendering)
    clans.js              # /clans (CRUD, admin only)
    players.js            # /players (CRUD, admin sees all, manager sees own clan)
    users.js              # /users (admin user management, invite generation)
    seeding.js            # /seeding (public leaderboard), /seeding/config, /seeding/rewards, /seeding/report/:key, /seeding/progress/:key/:steamId
    whitelist.js          # /whitelist/:key? (plain text output)
    import.js             # /import (bulk import from whitelist text)
    api.js                # /api (admin settings page), /api/seeding (public JSON leaderboard)
views/                    # EJS templates
  layout.ejs              # Main layout with nav, header, flash messages
  partials/
    nav.ejs               # Sidebar navigation (role-aware links)
    flash.ejs             # Error/success message rendering
  dashboard.ejs           # Admin stats + recent players / Manager clan stats
  clans.ejs               # Clan list with player counts, managers, forms
  players.ejs             # Player table with search, filter, add/edit modals
  users.ejs               # User list, edit modals, invite links table
  seeding.ejs             # Public leaderboard (layout: false)
  seeding-config.ejs      # Admin form for thresholds
  seeding-rewards.ejs     # Admin view of active rewards + seeders list
  api.ejs                 # API key configuration + endpoint docs
  import.ejs              # Textarea import form
  login.ejs, setup.ejs, invite.ejs, password.ejs, error.ejs
public/
  css/style.css           # Tailwind-like utility classes + custom styles
  js/app.js               # Mobile sidebar toggle, modal helpers, form interactions
  assets/                 # Logo, favicon
squadjs-plugin/
  whitelist-seeding.js    # SquadJS plugin (ES module)
  README.md               # Plugin install/config docs
```

### Database Schema

All tables use SQLite with `foreign_keys = ON`.

- **clans** (`id`, `name` UNIQUE, `player_limit`, `created_at`)
- **users** (`id`, `username` UNIQUE, `password_hash`, `role` enum: admin/manager, `clan_id` FK, `created_at`)
- **sessions** (`id`, `user_id` FK CASCADE, `token` UNIQUE, `expires_at`, `created_at`)
- **players** (`id`, `steam_id`, `player_name`, `clan_id` FK CASCADE, `expires_at`, `note`, `created_by` FK SET NULL, `created_at`, UNIQUE(`steam_id`, `clan_id`))
- **seeding_points** (`steam_id` PK, `player_name`, `points`, `lifetime_points`, `play_minutes`, `last_seen_at`, `updated_at`)
- **seeding_rewards** (`id`, `steam_id` UNIQUE, `player_name`, `expires_at`, `created_at`)
- **invites** (`id`, `token` UNIQUE, `role`, `clan_id` FK CASCADE, `expires_at`, `used_at`, `created_by` FK SET NULL, `created_at`)
- **config** (`key` PK, `value` text - JSON serialized)

Default config keys:
- `seeding_api_key` - auto-generated 6-char hex on first init if missing
- `seeding_enabled`, `seeding_points_needed` (default 60), `seeding_reward_days` (default 7)
- `seeding_min_players` (default 2), `seeding_max_players` (default 50)
- `whitelist_key` (default empty string)
- `seeding_leaderboard_api` (default true)

### Auth & Security Model

- **Sessions**: 32-byte random hex tokens stored in `sessions` table with 30-day expiry. Cookie is httpOnly, lax sameSite, secure flag only in production.
- **CSRF**:
  - Authenticated POSTs: HMAC-SHA256 of session token using a per-process `CSRF_SECRET`. Token passed as `_csrf` in forms.
  - Unauthenticated POSTs (login, setup, invite): Double-submit cookie pattern with `_csrf` cookie.
- **Rate limiting**: Per-IP login attempt map. 5 attempts per 60 seconds. Cleaned every 5 minutes.
- **Passwords**: bcryptjs, cost factor 10.
- **Username validation**: 3-32 chars, lowercase letters, numbers, dots, hyphens, underscores only.
- **Access control**:
  - `requireAuth` attaches `req.user` and `res.locals.user`
  - `requireAdmin` blocks non-admins with 403 error page
  - Managers can only view/edit players where `player.clan_id == req.user.clan_id`
  - User ID 1 (first admin created at setup) cannot be deleted
  - Admins cannot demote themselves

### Routes & Endpoints

**HTML/UI Routes (require auth unless noted)**

| Method | Path | Access | Notes |
|--------|------|--------|-------|
| GET | `/` | any | Role-based dashboard |
| GET/POST | `/setup` | no-users | Initial admin creation |
| GET/POST | `/login` | public | CSRF cookie protected |
| GET | `/logout` | any | Clears session cookie |
| GET/POST | `/password` | auth | Change own password, invalidates other sessions |
| GET/POST | `/invite/:token` | public | Accept invite, create account |
| GET | `/clans` | admin | Clan list with counts |
| POST | `/clans` | admin | Create clan (name sanitized: `[^a-zA-Z0-9_-]` stripped) |
| POST | `/clans/:id/edit` | admin | Update clan |
| POST | `/clans/:id/delete` | admin | Delete clan (cascades to players) |
| GET | `/players` | auth | Searchable/filterable player list. Managers see own clan only. |
| POST | `/players` | auth | Add player. Validates 17-digit Steam ID. Checks clan limit. Standalone players must be unique per Steam ID. Managers without a clan are blocked. |
| POST | `/players/:id/edit` | auth | Edit player name/expiry/note. Managers restricted to own clan. |
| POST | `/players/:id/delete` | auth | Delete player. Managers restricted to own clan. |
| GET | `/users` | admin | User list + pending invites |
| POST | `/users/invite` | admin | Generate invite link (7-day expiry). Manager invites require clan_id. |
| POST | `/users/invite/:id/revoke` | admin | Delete invite |
| POST | `/users/:id/edit` | admin | Edit user (username, role, clan, optional password reset) |
| POST | `/users/:id/delete` | admin | Delete user (not self, not ID 1) |
| GET | `/seeding` | public | Leaderboard page (layout: false) |
| GET | `/seeding/config` | admin | Threshold configuration form |
| POST | `/seeding/config` | admin | Save thresholds |
| GET | `/seeding/rewards` | admin | Active rewards + seeders list |
| POST | `/seeding/rewards/:id/delete` | admin | Revoke a reward |
| GET | `/import` | admin | Import form |
| POST | `/import` | admin | Parse whitelist text, create clans/players/seeders |
| GET | `/api` | admin | API settings page |
| POST | `/api` | admin | Save whitelist key, seeding key, leaderboard toggle |

**API/External Routes**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/whitelist/:key?` | optional key | Plain text whitelist output. Cached 60s. |
| POST | `/seeding/report/:apiKey` | apiKey | SquadJS plugin posts `{ players: [{ steamId, name }] }`. Awards points if enabled and player count in [min, max]. Also tracks play_minutes when count >= max_players. |
| GET | `/seeding/progress/:apiKey/:steamId` | apiKey | Returns player's seeding progress JSON. |
| GET | `/api/seeding` | public (toggleable) | JSON leaderboard data. |

### Whitelist Output Format

```
Group=Whitelist:reserve
Admin=765...:Whitelist // ClanName - PlayerName - Expires: YYYY-MM-DD
Admin=765...:Whitelist // Standalone - PlayerName
Admin=765...:Whitelist // Seeder - PlayerName - Expires: YYYY-MM-DD
```

- Active players + active seeding rewards combined.
- Duplicate Steam IDs are deduplicated (players take priority over seeders).
- Cache invalidated on any player/reward mutation or cleanup.

### Seeding Logic Details

- **Points**: Each valid tick (player count between min and max, inclusive) increments `points` and `lifetime_points` by 1.
- **Reward trigger**: When `points >= points_needed`, a `seeding_rewards` row is created with `expires_at = now + reward_days`, and `points` is reset to 0.
- **Play time**: When `playerCount >= max_players`, `play_minutes` is incremented instead of seeding points. This happens independently of whether seeding is enabled.
- **Progress endpoint**: Returns current points, lifetime_points, play_minutes, has_reward bool, and reward_expires_at.
- **Leaderboard filtering**: `getSeedingPoints()` and `searchSeedingPoints()` only include players whose `last_seen_at` is within the last 3 months.

### Import Parsing

The import route parses lines matching:
```
Admin=<17-digit Steam ID>:Whitelist // [<Tag>] <PlayerName>[@<Discord>]
```
- Tag `Seeder` (case-insensitive) creates a `seeding_rewards` entry.
- Any other tag creates a clan (if new) and a player under that clan.
- `default_player_limit` applies to auto-created clans.
- `seeder_days` sets reward expiry duration.

### Frontend Conventions

- CSS: Custom utility classes in `public/css/style.css`. Uses a dark theme with accent colors.
- JS: `public/js/app.js` handles mobile sidebar toggle and modal open/close. No build step.
- Forms: All mutations are POST. `_csrf` field included in every form.
- Flash messages: Passed as `error`/`success` locals to templates. Some redirects use query params (`/players?error=...`).

### Dev & Deployment

- **Run locally**: `npm install && npm start` (or `npm run dev` for Node.js --watch)
- **Docker**: `docker compose up -d`. DB persisted in `whitelist-data` volume at `/data/whitelist.db`.
- **No build step**: Direct Node.js execution. Static files served from `public/`.
- **Dependencies**: express, ejs, express-ejs-layouts, sql.js, bcryptjs, cookie-parser.
- **Tests**: `npm test` runs blackbox HTTP tests using Node's built-in `node:test` runner and `supertest`. Tests exercise routes directly, parse HTML for CSRF tokens, and use a shared test database. Run with `--test-concurrency=1` to avoid DB state conflicts between files. Test helpers in `tests/helpers.js` provide `setup()`, `resetDatabase()`, `createAdminAgent()`, `createManagerAgent()`, and CSRF extraction utilities.
- **Test startup behavior**: `server.js` exports `{ app, startPromise }`. It only starts `app.listen()` and periodic cleanup when `require.main === module`, so tests can import the app without binding the configured port.
- **Test database**: Tests set `process.env.DB_PATH` to `tests/test.db` before requiring `server.js`. The file is generated runtime state and is ignored by `.gitignore`.
- **Test environment caveat**: Some restricted sandboxes block `supertest` from opening an ephemeral local listener and fail with `listen EPERM: operation not permitted 0.0.0.0`. That indicates environment restrictions, not necessarily application failure.
- **Rate limit cleanup**: Started explicitly via `startRateLimitCleanup()` in `server.js` (not auto-started at module load). Tests call `resetLoginAttempts()` between runs. `stopRateLimitCleanup()` available for teardown.
- **Date validation**: `validateDate()` in `src/auth.js` validates `YYYY-MM-DD` format and checks the date actually exists (rejects impossible dates like 2024-99-99). Used by both create and edit player routes.
- **Test DB reset**: `db.resetAllTables()` truncates all tables and forces a disk write. Used by test helpers instead of raw `db.run()` calls.

### Standard Change Workflow

For backend/UI changes:

- Find the route in `src/routes/`, the database helper in `src/db.js`, and the matching view in `views/`.
- Keep mutation routes as POST handlers protected by `requireAuth` and `verifyCsrf`; add `requireAdmin` for admin-only changes.
- Pass `_csrf` in every EJS form that performs a POST.
- Use `res.render()` when preserving form context and displaying validation errors; use redirects for successful mutations or simple failures already handled by query-string flash messages.
- Add or update tests in the matching `tests/*.test.js` file. Prefer `tests/helpers.js` helpers over custom setup.
- Run `npm test` when the environment allows local listener binding.

For database changes:

- Add schema changes in `src/db.js` inside `init()`.
- For existing installs, add migrations with idempotent `ALTER TABLE` guarded by `try/catch`, matching the existing `play_minutes` pattern.
- Add query helpers in `src/db.js` rather than issuing raw SQL from route files.
- Continue storing config values through `getConfigValue()` and `setConfigValue()` so JSON serialization stays consistent.
- Remember that `sql.js` is in-memory until exported; `db.run()` schedules a debounced save and `db.saveNow()` forces one.

For whitelist-affecting changes:

- Call `invalidateCache()` after any mutation to players, clans that affect whitelist comments, or seeding rewards.
- Keep whitelist output in Squad `RemoteAdminListHosts` format and preserve the first line `Group=Whitelist:reserve`.
- Sanitize user-controlled comment fields before writing whitelist text; `generateWhitelist()` strips CR/LF from names.
- Preserve deduplication priority: normal players win over seeding rewards for the same Steam ID.

For access-control changes:

- Admins can manage all clans, users, players, API settings, imports, and seeding configuration.
- Managers can only view, add, edit, or delete players in their own clan.
- Managers with no `clan_id` must not be able to create standalone players.
- User ID 1 is the original owner and cannot be deleted.
- Admins cannot demote themselves.

For seeding changes:

- `/seeding/report/:apiKey` is the write endpoint used by SquadJS; keep key comparison timing-safe.
- `seeding_enabled` controls only seeding point accrual, not full-server play-time tracking.
- Full-server play time is tracked when `playerCount >= seeding_max_players`.
- Seeding points accrue only when enabled and `playerCount` is between `seeding_min_players` and `seeding_max_players`, inclusive.
- When a reward is created or revoked, call `invalidateCache()` so `/whitelist` updates immediately.
- Leaderboard queries intentionally hide seeding rows not seen in the last 3 months.

### Things to Know When Modifying

- **Cache invalidation**: Always call `invalidateCache()` from `src/utils.js` after any player or seeding reward mutation. The whitelist text is cached for 60 seconds.
- **Database saves**: `db.run()` schedules a save with 100ms debounce. `db.saveNow()` forces immediate write. Process signals trigger `saveNow()`.
- **Schema migrations**: Applied in `db.init()` via try/catch around `ALTER TABLE` (e.g., `play_minutes` column was added this way).
- **Config values**: Always JSON serialized/deserialized via `getConfigValue`/`setConfigValue`.
- **Clan name sanitization**: In `clans.js` route, names are stripped to `[a-zA-Z0-9_-]` on create and edit.
- **Date handling**: Expiry dates stored as `YYYY-MM-DD HH:MM:SS`. UI accepts `YYYY-MM-DD` only; `23:59:59` is appended automatically. Impossible dates (e.g. 2024-99-99) are rejected by `validateDate()` before storage.
- **SquadJS plugin**: ES module using `fetch`. `progressUrl` defaults to `apiUrl` with `/report` replaced by `/progress`.
- **Route ordering**: `server.js` mounts `/seeding` before `/api`; keep external JSON endpoints under `/api` and SquadJS endpoints under `/seeding`.
- **Import side effects**: Imported clan players and seeding rewards affect whitelist output, so import mutations must invalidate the whitelist cache.
- **Rendered errors**: If a route re-renders a view after validation failure, ensure the render context includes every variable the EJS template expects.
- **Case normalization**: Usernames are lowercased before validation/storage. Clan names are sanitized but case is otherwise preserved.
- **Steam IDs**: UI player routes validate exactly 17 digits. The seeding report endpoint currently trusts SquadJS input and only skips missing `steamId`.
- **No API key env vars**: Whitelist and seeding API keys live in the `config` table and are changed from the admin UI, not from environment variables.

### Testing Patterns

- Use `request.agent(app)` for flows that need cookies/session state.
- For unauthenticated CSRF-protected forms (`/setup`, `/login`, `/invite/:token`), get the `_csrf` cookie first and submit it as `_csrf`.
- For authenticated forms, call the GET page first and extract the hidden `_csrf` input from rendered HTML.
- Reset state with `resetDatabase()` in `beforeEach()`; it also resets default config and login attempts.
- Keep test files serial. The database module is a singleton and tests share one `sql.js` instance.
- Avoid assertions that depend on exact generated tokens, timestamps, or invite URLs beyond stable prefixes.

### Gotchas

- `sql.js` runs entirely in memory; the `.db` file is loaded on startup and exported on save. Large datasets will use more RAM.
- The seeding report endpoint does not validate player Steam ID format; it trusts the SquadJS plugin.
- Whitelist key and seeding API key are stored in the `config` table, not env vars (except `DB_PATH` and `PORT`).
- The `seeding_enabled` config only controls point accrual; play time tracking always runs when player count >= max_players.
- On first boot, `seeding_api_key` is auto-generated to a 6-character hex string if missing.
