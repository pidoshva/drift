# Developer setup (one-time)

Everything below is done once. After this the system runs itself.

## 0. Prerequisites
- Node 22, pnpm, `gh` CLI (logged in), a Cloudflare account (free), a Telegram account.
- `pnpm install`, copy `.env.example` → `.env`.

## 1. Tokens
```
openssl rand -hex 32   # → DRIFT_ADMIN_TOKEN   (CLI/CI ↔ worker)
openssl rand -hex 16   # → DRIFT_DASHBOARD_TOKEN (typed once into /dash/)
```
Put both in `.env`.

## 2. Telegram bot (from the owner, see owner-guide.pdf)
- Owner creates a bot with @BotFather and sends you the token → `TELEGRAM_BOT_TOKEN` in `.env`.
- Owner opens the bot and presses Start (or adds it to a group and says hi).
- `./bin/drift contact telegram-chat-id` → `./bin/drift contact set telegram <id>`.

## 3. KSL
- Open any of the dealer's listings on cars.ksl.com. The search page
  `https://cars.ksl.com/search/memberId/<ID>` must list only their cars; the ID is in the listing
  page payload (`"contact":{"memberId":…}`) — `curl -sA 'Mozilla/5.0' <listing-url> | /usr/bin/grep -o '"memberId":[0-9]*' | head -1`.
- `./bin/drift config set sources.ksl.memberId <ID>` then `./bin/drift sync --dry-run --limit 3` to verify.

## 4. Cloudflare Worker + D1
```
pnpm wrangler login                      # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in .env
./bin/drift worker create-db             # writes worker.d1DatabaseId into drift.config.json
./bin/drift worker migrate               # applies worker/schema.sql
./bin/drift deploy worker                # prints the workers.dev URL
./bin/drift config set worker.url https://drift.<account>.workers.dev
./bin/drift worker secrets               # pushes TELEGRAM_BOT_TOKEN, ADMIN/DASHBOARD tokens, (RESEND, TURNSTILE)
./bin/drift worker health
./bin/drift contact test                 # a test lead must arrive in Telegram
```
Optional email: create a Resend account, verify a domain, set `RESEND_API_KEY`, `drift contact set email …`,
`drift config set contact.fromEmail leads@<verified-domain>`, `drift contact set methods telegram,email`.
Optional bot protection: Cloudflare Turnstile → `drift config set contact.turnstileSiteKey …` + `TURNSTILE_SECRET_KEY`.

## 5. GitHub
- Repo secrets: `TELEGRAM_BOT_TOKEN`, `DRIFT_ADMIN_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Settings → Pages → Source: **GitHub Actions**. (Private repos need GitHub Pro for Pages; public repos are free.)
- `./bin/drift config set site.url https://<user>.github.io/<repo>`. For a custom domain, set it in
  Settings → Pages (GitHub manages the CNAME) and then `drift config set site.url https://<domain>`.
- Push to `main`. `sync.yml` runs (push + every 2 h), builds and deploys. `deploy-worker.yml` runs when
  `worker/**` or `drift.config.json` change.
- Demo mode before the KSL id exists: repo variable `DRIFT_MOCK_KSL=1`.

## 6. Verify
```
./bin/drift doctor
./bin/drift sync --remote && gh run watch
./bin/drift stats
./bin/drift digest --send
```

## Day-2 operations
| Need | Command |
|---|---|
| Change phone / email / Telegram target | `drift contact set phone +1801…` → push (or `drift deploy worker`) |
| Change sync frequency | `drift schedule set sync --every 1h` → commit + push |
| Trigger a sync now | `drift sync --remote` |
| A car shows as sold by mistake | `drift listings mark <id> active` → push |
| Add a car that is not on KSL | `data/manual/<id>.json` (see `src/sources/manual.ts`) → push |
| See leads / traffic | `drift leads`, `drift stats`, `/dash/` with the dashboard token |
| See job history | `drift logs --remote`, `drift logs --actions` |
| Change the design | `src/site/theme/*` → push |
