# Deploying mskasal.com

One Docker Compose stack runs everything:

| Service | What it does |
|---|---|
| `caddy` | Front door: HTTPS, routes `PUBLIC_DOMAIN` to the site and `ADMIN_DOMAIN` to the back office |
| `site` | The Rust site (CV, experiments, notes, live rooms), built from this repo |
| `oauth2-proxy` | Google sign-in in front of Dossier; only `ALLOWED_EMAIL` gets in |
| `dossier` | [Dossier](https://github.com/AienTech/dossier), the job-search back office |
| `db` | PostgreSQL for Dossier |
| `cloudflared` | Optional: Cloudflare Tunnel for hosting at home |

It runs the same on a home computer, an AWS/Hetzner/… VPS, or an arm64 board.

## 1. Prerequisites

- Docker with the Compose plugin; 2 vCPUs and 2 GB of RAM at least (4 GB is comfortable).
- A domain whose DNS you control (`mskasal.com`), and a name for the back office,
  e.g. `desk-7f3k.mskasal.com`. Google sign-in guards it; the odd name just keeps it quiet.
- This repository checked out on the machine.

## 2. Google sign-in

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create a project (or reuse one), configure the OAuth consent screen
   (External, publish it so access doesn't expire after 7 days).
2. **Create credentials → OAuth client ID → Web application.** Authorized redirect URIs:
   - `https://<ADMIN_DOMAIN>/oauth2/callback` (the sign-in)
   - `https://<ADMIN_DOMAIN>/api/google/callback` (only if you also connect Gmail
     and Calendar in Dossier; enable the Gmail API and Google Calendar API for that)
3. Put the client ID and secret in `.env` as `OAUTH2_PROXY_CLIENT_ID` / `OAUTH2_PROXY_CLIENT_SECRET`
   (and, for Gmail/Calendar, the same or a second client as `DOSSIER_GOOGLE_CLIENT_ID` / `_SECRET`).

## 3. Configure

```bash
cd deploy
cp .env.example .env        # then edit: PUBLIC_DOMAIN, ADMIN_DOMAIN, TLS_MODE, ACME_EMAIL, OAuth client
./scripts/init-env.sh       # fills in secrets, writes emails.txt, asks for the Dossier password
```

`init-env.sh` never overwrites a value that is already set, so run it again after edits.

**Claude in Dossier**, either or both:

- **API key:** `DOSSIER_AI_PROVIDER=anthropic`, `DOSSIER_AI_MODEL=claude-sonnet-5-5`,
  `DOSSIER_AI_KEY=<key from console.anthropic.com>`. Dossier writes documents itself.
- **Claude connector:** in Dossier, Settings → Claude connector, then add it in claude.ai
  (see [Connecting Claude](https://github.com/AienTech/dossier/wiki/Connecting-Claude)).
  Claude then works with Dossier on your own Claude plan. The connector's paths pass
  oauth2-proxy because they carry their own OAuth token, which Dossier checks.

## 4. Pick where it runs

### Home computer (free, no open ports): Cloudflare Tunnel

1. Move the domain's DNS to Cloudflare (free plan).
2. Zero Trust → Networks → Tunnels → **Create a tunnel** (cloudflared). Copy the token.
3. Add two public hostnames to the tunnel: `PUBLIC_DOMAIN` and `ADMIN_DOMAIN`, both with
   service `http://caddy:80`.
4. In `.env`: `TLS_MODE=tunnel`, `COMPOSE_PROFILES=tunnel`, `CLOUDFLARE_TUNNEL_TOKEN=<token>`,
   then run `./scripts/init-env.sh` again (it sets `CADDY_SCHEME=http://`).
5. Also add `COMPOSE_FILE=compose.yml:compose.tunnel.yml` to `.env` (with `:compose.arm64.yml`
   on arm64). It keeps Caddy's ports on 127.0.0.1, so nothing is reachable around the tunnel,
   and plain `docker compose …` commands pick the right files.
6. In Cloudflare, SSL/TLS → Edge Certificates → **Always Use HTTPS**: the tunnel otherwise
   serves plain `http://` too.

### A VPS (AWS Lightsail/EC2, Hetzner, …)

1. DNS A (and AAAA) records for `PUBLIC_DOMAIN` and `ADMIN_DOMAIN` to the server.
2. Open ports 80 and 443 (and UDP 443 for HTTP/3).
3. `TLS_MODE=acme` and `ACME_EMAIL` in `.env`. Caddy gets Let's Encrypt certificates on its own.

### arm64 (Oracle Always Free, Raspberry Pi, Graviton)

Dossier's published image is amd64-only; build it from the pinned release instead:

```bash
docker compose -f compose.yml -f compose.arm64.yml up -d --build
```

## 5. Start and check

```bash
docker compose up -d --build
./scripts/check.sh https://<PUBLIC_DOMAIN> https://<ADMIN_DOMAIN>
```

`check.sh` confirms the site answers, the back office demands Google sign-in, the
Claude connector's routes reach Dossier, Dossier is healthy, and WebSocket rooms
upgrade. Then open `https://<ADMIN_DOMAIN>`, sign in with Google, then with the
Dossier password, and pick the AI provider if you didn't set it in `.env`.

To try it on a laptop without a domain: `TLS_MODE=internal`,
`PUBLIC_DOMAIN=site.localhost`, `ADMIN_DOMAIN=admin.localhost`, then
`CHECK_RESOLVE=127.0.0.1 ./scripts/check.sh https://site.localhost https://admin.localhost --insecure`.
(Google sign-in itself needs a real domain in the OAuth client.)

## 6. Day to day

- **Upgrade Dossier:** change `DOSSIER_VERSION`, then `docker compose pull && docker compose up -d`.
- **Update the site:** `git pull && docker compose up -d --build site`.
- **Take the résumé offline:** `RESUME=off` in `.env`, then `docker compose up -d caddy`
  (`/` redirects to `/experiments`; set it back to `on` the same way).
- **Backups:** Dossier keeps nightly backups in its `dossier-data` volume. For a full copy
  you can move elsewhere, `./scripts/backup.sh` writes the database and `/data` to
  `backups/<timestamp>/`; `./scripts/restore.sh backups/<timestamp>` puts them back.
- **Logs:** `docker compose logs -f <service>`.

## Troubleshooting

- **Building behind a corporate or TLS-inspecting proxy:** pass its CA bundle as a
  build secret, which the site's Dockerfile installs in the build stage only:
  `docker build --secret id=extra_ca,src=/path/to/ca.pem ..` (with `--build-arg HTTPS_PROXY=…`
  if the proxy is needed too). Where apt is blocked, the WASM experiments are built without
  `wasm-opt`; they still work, just a little larger.

- **`check.sh` says admin `/` → 502:** oauth2-proxy or Dossier isn't up: `docker compose ps`,
  then `docker compose logs oauth2-proxy dossier`.
- **Google says `redirect_uri_mismatch`:** the OAuth client's redirect URI must be exactly
  `https://<ADMIN_DOMAIN>/oauth2/callback`.
- **Signed in with Google but get 403:** that account isn't in `emails.txt`
  (`ALLOWED_EMAIL`, then `./scripts/init-env.sh` and `docker compose restart oauth2-proxy`).
- **Certificates don't arrive (acme):** DNS must point at the server and ports 80/443 must be
  reachable from the internet.
