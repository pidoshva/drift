# drift — dealership website system

Static dealership website on GitHub Pages, kept in sync with the dealer's KSL Cars listings,
with lead routing (Telegram / email) and analytics. Managed entirely through the `drift` CLI.
No AI/LLM is used at runtime anywhere. Everything runs on free tiers.

## Purpose and non-negotiables

- The dealer never touches the site. Sync, build, deploy, lead routing and the daily digest are
  automated. Humans only change `drift.config.json` (via the CLI) and the theme.
- Free: GitHub Actions (jobs), GitHub Pages (site), Cloudflare Worker + D1 (contact form,
  analytics, admin API), Telegram Bot API (notifications). Optional: Resend (email), Turnstile.
- No runtime AI. Never add an LLM call or model token to this system.
- KSL has **no public API**. `src/sources/ksl` reads the same server-rendered pages a browser
  gets (`cars.ksl.com/search/memberId/<id>` and `/listing/<id>`) and parses the embedded
  Next.js Flight payload. Be polite: ~1 request per 1.5s, details only for new/changed cars.
- Volume target: ≤100 cars/month now; design must stay cheap as it grows (no per-car cost).

## Architecture (data flow)

```
KSL pages ──▶ src/sources/ksl ──▶ src/jobs/sync.ts ──▶ data/inventory.json + data/archive.json
data/manual/*.json ──▶ src/sources/manual ─┘                 │ (committed by GitHub Actions)
                                                             ▼
                                      src/site/build.ts ──▶ dist/ ──▶ GitHub Pages
                                                             │
          browser ──(sendBeacon /e, POST /contact)──▶ worker/ (Cloudflare Worker + D1)
                                                             │──▶ Telegram (lead card w/ photo), Resend email
          drift stats / leads / logs --remote / dash page ◀──┘ /admin/* (Bearer token)
```

| Layer | Path | Notes |
|---|---|---|
| Domain model | `src/core/listing.ts` | `Listing` (zod schema) is the one shared object. `contentHash` decides "changed". |
| Inventory store | `src/core/inventory.ts` | Pure `mergeSnapshot()` (added/updated/unchanged/gone) + file IO. |
| Config | `src/core/config.ts`, `drift.config.json` | Single committed source of truth (non-secret). Zod-validated. |
| Secrets | `src/core/env.ts`, `.env.example` | Only from env/.env/GitHub secrets. Never in config. |
| Logging | `src/core/logger.ts` | Pretty on TTY, JSON in CI, always appended to `.drift/drift.log`. |
| Sources | `src/sources/` | `InventorySource` interface; `ksl/` (rsc parser, client, mapper, mock), `manual.ts`. |
| Jobs | `src/jobs/` | `sync.ts`, `digest.ts`, `events.ts` (job → worker). |
| Site | `src/site/` | `build.ts`, `context.ts`, `templates/` (html tagged-template, no framework), `theme/`, `client/`. |
| Worker | `worker/src/` | `index.ts` router; `contact.ts`, `analytics.ts`, `admin.ts`; `schema.sql` (D1). |
| CLI | `src/cli/` | `main.ts` + one file per command group in `commands/`. Thin: parse → call → print. |
| Automation | `.github/workflows/` | `sync.yml` (cron+push → sync, commit data, build, deploy Pages), `deploy-worker.yml`, `digest.yml`, `ci.yml`. |
| Tests | `tests/` | vitest. Fixtures in `tests/fixtures/` (real KSL page shapes, mock seed). |

## Where to change what

- **Look & feel**: `src/site/theme/tokens.css` (colors, fonts, radii) → `components.css` → `theme.json`
  (nav, hero copy, highlights, labels, card facts). Templates in `src/site/templates/` if structure changes.
- **Dealer info / routing / schedules**: `drift.config.json` via `drift config set`, `drift contact set`,
  `drift schedule set`. The worker reads routing as vars; redeploy with `drift deploy worker` (CI does it on push).
- **New marketplace (e.g. Facebook)**: implement `InventorySource` in `src/sources/<name>/`, register in
  `src/sources/index.ts`, add `source` enum value in `listing.ts`.
- **New analytics event**: add to `EVENT_TYPES` (worker/src/analytics.ts), emit with `track()` in
  `src/site/client/site.js`, surface in `worker/src/admin.ts` → `dash.js` / `stats.ts`.
- **New page**: `src/site/templates/pages/<name>.ts` returning `{path, html}`, add to `pages` in `build.ts`.
- **Worker secrets**: `.env` → `drift worker secrets`. New secret = add to `Env` (worker/src/types.ts),
  `.env.example`, `env.ts` SECRET_NAMES, `worker.ts` secrets map, `doctor.ts`.

## Commands (`./bin/drift`, or `pnpm drift`)

`sync [--mock|--dry-run|--limit|--force|--source|--remote]`, `build`, `serve`, `deploy site|worker`,
`listings list|show|mark`, `logs [--remote --type lead|pageview…] [--actions]`, `stats [--days]`,
`leads`, `config show|get|set|validate`, `schedule show|set sync|digest --every 2h`,
`contact show|set phone|email|telegram|methods | telegram-chat-id | test`,
`worker dev|create-db|migrate|secrets|health|render-config`, `digest [--send]`, `doctor`.
`-v` for debug logs. `DRIFT_LOG=debug`, `DRIFT_LOG_JSON=1`.

## Development loop

```
pnpm install
./bin/drift sync --mock --no-notify   # seed data/ from tests/fixtures/mock-ksl-listings.json
./bin/drift worker dev                # local worker + local D1 at :8787 (uses .env or dev tokens)
./bin/drift config set worker.url http://localhost:8787 && ./bin/drift serve   # site at :4321
pnpm test && pnpm typecheck
```
Mock knobs: `DRIFT_MOCK_SOLD=id,id` (cars disappear → sold), `DRIFT_MOCK_PRICE=id:price`,
`TELEGRAM_API_BASE=http://localhost:8099` (point Telegram calls at a fake server).
CI (`ci.yml`) runs typecheck, tests, mock sync and build on every PR.
Set repo variable `DRIFT_MOCK_KSL=1` to make the scheduled sync use mock data (demo mode).

## Conventions and gotchas

- TypeScript ESM, Node 22, run via `tsx` (no build step for CLI). Imports use `.js` extensions.
- zod v4: use `.prefault({})` for nested objects with defaults (`.default({})` fails typing).
- Templates: `html\`\`` escapes everything; wrap trusted markup in `raw()`. Never concatenate strings into HTML.
- Templates write root-absolute links (`/inventory/`); `applyBasePath()` in `build.ts` rewrites them for
  GitHub Pages project sites (`https://user.github.io/repo/`). Client JS reads `data-base` on `<body>`.
- Analytics beacons are sent as `text/plain` on purpose (no CORS preflight). Worker parses JSON anyway.
- Worker CORS allows only `SITE_URL` origin + localhost. `/admin/*` needs `Authorization: Bearer`
  (`ADMIN_TOKEN` = everything, `DASHBOARD_TOKEN` = `GET /admin/stats` only).
- Sold detection: a listing missing from the dealer's KSL search → fetch its page; `Active` keeps it,
  a confirmed non-Active status or 404/410 → `sold` (or `expired` past `expiresAt`). Any other failure
  (429/5xx, network, parse) keeps the car, lists it under `report.unverified` (counted in `totals.warnings`;
  CLI and Telegram show "could not be verified"; in `sync.notify=changes` mode it triggers the Telegram
  report by itself) and re-checks next run.
- `drift listings mark <id> sold|removed|expired` sets `statusLockedAt`; sync skips that id (no re-add, no
  detail fetch) and keeps it archived even while KSL still lists it, until `drift listings mark <id> active`.
- `drift sync` exits non-zero only when a whole source failed (`report.errors`); per-listing detail/gone-check
  failures are `report.warnings`, data is still written and the workflow still commits and deploys.
- `data/inventory.json` and `data/archive.json` are committed by the sync workflow (bot commit on main).
  Never hand-edit them; use `drift listings mark` or `data/manual/*.json`.
- Quiet runs write nothing: `runSync` rewrites `data/` only when `inventoryKey()` (id, hash, status,
  detailFetchedAt, expiry, lock) differs, so `syncedAt` / `lastSeenAt` / search-row favorites may lag until
  the next real change. `report.wrote` says whether files changed; `sync.yml` skips the Pages deploy on a
  scheduled run with no commit (push and `workflow_dispatch` always deploy).
- Logs never crash a job. Telegram/worker reporting is best-effort. KSL failure keeps the last inventory.
- The sync workflow concurrency group is `sync`; it also deploys Pages, so never add a second Pages deploy.
- Keep dependencies minimal (commander, zod + dev tooling). No CSS/JS frameworks.
- Use `/usr/bin/grep` on this machine (grep is aliased to ugrep).

## Testing expectations

Every change to parsing, merging, templates or the worker needs a test in `tests/`. Prefer fixtures over
network. Before pushing: `pnpm typecheck && pnpm test && ./bin/drift sync --mock --dry-run && ./bin/drift build`.
