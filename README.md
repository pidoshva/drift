# drift

A zero-maintenance dealership website: static site on GitHub Pages that mirrors the dealer's
**KSL Cars** listings, routes "Contact me" messages to **Telegram / email**, tracks views and leads,
and shows a private **dashboard**. Operated with the `drift` CLI. Free to run. No AI at runtime.

```
./bin/drift sync          # pull inventory from KSL into data/
./bin/drift build         # render the site into dist/
./bin/drift stats         # traffic, car views, leads, sales
./bin/drift leads         # who asked about which car
./bin/drift doctor        # what is configured / missing
```

- **Developer setup**: [docs/SETUP.md](docs/SETUP.md)
- **Owner guide (non-technical)**: [docs/owner-guide.pdf](docs/owner-guide.pdf)
- **Architecture & conventions**: [CLAUDE.md](CLAUDE.md)

## How it works

1. `sync.yml` runs every 2 hours on GitHub Actions: `drift sync` reads the dealer's public KSL
   listings, writes `data/inventory.json` (for sale) and `data/archive.json` (sold), commits, then
   `drift build` renders the site and deploys it to GitHub Pages.
2. The site is plain HTML/CSS/JS. Each car page has a contact form and a "Call now" button.
3. A tiny Cloudflare Worker receives contact-form posts and analytics beacons, stores them in D1,
   and sends each lead to Telegram as a card with the car's photo, price, links and the buyer's phone.
4. `digest.yml` sends a daily Telegram summary. `/dash/` shows the same numbers with charts.

## Local demo (no accounts needed)

```
pnpm install
./bin/drift sync --mock --no-notify
./bin/drift worker dev            # terminal 1
./bin/drift config set worker.url http://localhost:8787
./bin/drift serve                 # terminal 2 → http://localhost:4321  (dashboard token: dev-dash-token)
```
