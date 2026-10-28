# mskasal.com platform — design

Date: 2026-10-28
Status: approved in conversation, awaiting written-spec review

## 1. Goal

One self-hostable stack that gives Mustafa:

- **A public showcase** at `mskasal.com`: a detailed CV, experiments and code
  posts (the existing Rust/Axum site, continued from the `epic/v2` branch).
- **Storage-less annotations** on the CV: a visitor selects text, writes a
  note, and every note and highlight lives in the page URL. Sharing the URL
  shares the notes. Nothing is stored on the server.
- **Live collaboration**: a visitor can open a room; everyone in the room sees
  each other's notes appear in real time over a WebSocket.
- **A private back office** for the job search: Dossier
  (github.com/AienTech/dossier) with Claude as its AI provider, reachable on a
  hard-to-guess subdomain and only after signing in with Mustafa's Google
  account.

The same stack must run unchanged on a home computer, an AWS VPS or any other
provider. Deploying to a concrete machine is a later step, triggered by
Mustafa.

### Success criteria

1. `docker compose up -d` in `deploy/` with a filled `.env` brings up the
   whole stack, with HTTPS on a public host.
2. Visiting the admin domain without the allowed Google account never reaches
   Dossier; the allowed account does.
3. Dossier's Claude connector endpoints work through the stack.
4. On the CV, selecting text, adding a note and copying the URL into a fresh
   browser shows the same highlight and note, with no server-side state.
5. Two browsers in the same room see each other's notes within a second;
   rooms are isolated from each other.
6. Automated tests cover the codec, anchoring, the room server and the
   end-to-end flows; CI runs them.

### Out of scope

- A blog/CMS beyond the static `/blog` page already on `epic/v2`.
- Changing Dossier's code (no fork); see §4.3.
- Choosing and provisioning the actual host. The stack is ready for it; the
  deploy itself happens when Mustafa says where.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Unique IDs | `crypto.randomUUID()` | Unique without fingerprinting; fingerprinting needs consent under GDPR. |
| Where notes live | URL fragment (`#…`) | The fragment never reaches the server, so the page is truly storage-less. |
| Anchoring | W3C text-quote selector (exact + prefix + suffix) | Survives CV edits that offsets would break. |
| Back office auth | oauth2-proxy (Google) in front of upstream Dossier | No fork to maintain; upgrades are a version bump. |
| Reverse proxy / TLS | Caddy | Automatic Let's Encrypt, small config, WebSocket proxying out of the box. |
| Home hosting | Optional `cloudflared` tunnel | Free, no public IP or port forwarding needed. |
| Packaging | One Docker Compose stack in `deploy/` | Same on every host. |

## 3. Repository layout (after the work)

```
mskasal.com/
├── src/                     Rust/Axum site (+ rooms module)
├── templates/               Askama templates (CV from epic/v2, annotated)
├── assets/annotate/         Annotation client (plain ES modules, no bundler)
├── tests/                   JS unit tests (node:test) and Playwright e2e
├── Dockerfile               Site image (fixed so it builds from scratch)
├── deploy/
│   ├── compose.yml          caddy, site, oauth2-proxy, dossier, db, cloudflared
│   ├── Caddyfile
│   ├── .env.example
│   ├── scripts/             backup.sh, restore.sh, check.sh
│   └── README.md            Install, hosting options, Google/Claude setup, upgrades
└── docs/superpowers/        This spec and the plan
```

`epic/v2` (updated CV, blog page, first selection prototype) is merged into the
working branch first; the work builds on it.

## 4. Infrastructure

### 4.1 Services

| Service | Image | Exposed | Notes |
|---|---|---|---|
| `caddy` | `caddy:2` (pinned) | 80, 443 | Routes `PUBLIC_DOMAIN` → `site:8080`, `ADMIN_DOMAIN` → `oauth2-proxy:4180`. Volumes for certificates. |
| `site` | built from repo `Dockerfile` | internal | The Rust site. |
| `oauth2-proxy` | `quay.io/oauth2-proxy/oauth2-proxy` (pinned) | internal | Google provider, upstream `http://dossier:3000`. |
| `dossier` | `ghcr.io/aientech/dossier:${DOSSIER_VERSION}` (default `v1.9.2`), or built from source for arm64 | internal | `mem_limit: 1g`, `/data` volume. |
| `db` | `postgres:18-alpine` | internal | Healthchecked, `pgdata` volume. |
| `cloudflared` | `cloudflare/cloudflared` (pinned) | none | Compose profile `tunnel`; uses `CLOUDFLARE_TUNNEL_TOKEN`. |

Only Caddy publishes ports. With the tunnel profile, Caddy's ports are not
needed at all and cloudflared forwards to Caddy over the internal network
(Caddy then serves plain HTTP internally; Cloudflare terminates TLS). The mode
is selected by `TLS_MODE=acme|tunnel|internal` in `.env` (`internal` uses Caddy's local CA, for testing on a machine without a public domain).

### 4.2 Configuration (`.env`)

Required: `PUBLIC_DOMAIN`, `ADMIN_DOMAIN`, `ACME_EMAIL` (acme mode),
`POSTGRES_PASSWORD`, `DOSSIER_PASSWORD` (argon2id hash), `DOSSIER_SECRET`,
`OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`,
`OAUTH2_PROXY_COOKIE_SECRET`, `ALLOWED_EMAIL`.

Optional: `DOSSIER_VERSION`, `TZ` (default `Europe/Berlin`),
`DOSSIER_AI_PROVIDER=anthropic`, `DOSSIER_AI_MODEL`, `DOSSIER_AI_KEY`, job
source keys, `DOSSIER_GOOGLE_CLIENT_ID/SECRET` (Gmail/Calendar),
`CLOUDFLARE_TUNNEL_TOKEN`, `TLS_MODE`.

`deploy/scripts/init-env.sh` creates `.env` from `.env.example` with the random
secrets filled in and runs Dossier's `hash-password` for the password.

### 4.3 Back office access

- oauth2-proxy with `--provider=google`, `--authenticated-emails-file`
  containing only `ALLOWED_EMAIL`, secure cookies scoped to `ADMIN_DOMAIN`,
  `--reverse-proxy`, `--set-xauthrequest`.
- Paths that bypass oauth2-proxy auth via `--skip-auth-route`, because the
  Claude connector brings its own OAuth token and Dossier checks it:
  `^/api/mcp`, `^/api/oauth`, `^/\.well-known/oauth-`, plus `^/api/health`
  for health checks.
- Dossier's own password remains as a second factor ("Keep me signed in" keeps
  it for 30 days). Removing it would need a fork; not planned.
- Dossier's PDF renderer calls `http://localhost:3000` inside its own
  container, so it never passes through the proxy (verified in
  `src/lib/pdf/render.ts`).
- Google OAuth clients: one for oauth2-proxy (redirect
  `https://ADMIN_DOMAIN/oauth2/callback`); Dossier's optional Gmail/Calendar
  client uses `https://ADMIN_DOMAIN/api/google/callback`. One Google Cloud
  project can hold both; the README walks through it.
- `DOSSIER_PUBLIC_URL=https://${ADMIN_DOMAIN}`.

### 4.4 AI provider

`DOSSIER_AI_PROVIDER=anthropic` with an Anthropic API key and model
(`.env.example` suggests `claude-sonnet-5-5`). Alternatively Dossier's Claude
connector (Settings → Claude connector) lets Mustafa use it from claude.ai on
his Claude plan; the stack supports both, the README explains both.

### 4.5 Hosting targets

- **Home computer**: Docker + `TLS_MODE=tunnel` + Cloudflare Tunnel (free;
  the domain's DNS must be on Cloudflare).
- **VPS (AWS Lightsail/EC2, Hetzner, …)**: Docker + `TLS_MODE=acme`, DNS A
  records for both domains to the server, ports 80/443 open. Minimum 2 vCPU,
  2 GB RAM (4 GB recommended).
- **arm64 hosts (Oracle Always Free, Raspberry Pi, Graviton)**: the published
  Dossier image is amd64-only, so `compose.arm64.yml` builds Dossier from the
  pinned upstream tag.

### 4.6 Operations

- Backups: Dossier's nightly backups in its `data` volume, plus
  `scripts/backup.sh` (`pg_dump` + `/data` tarball into `deploy/backups/`) and
  `scripts/restore.sh`.
- Upgrades: change `DOSSIER_VERSION`, `docker compose pull && docker compose up -d`.
- `scripts/check.sh`: after deploy, verifies public site 200, admin root
  redirects to Google sign-in, `/.well-known/oauth-protected-resource` is not
  intercepted, and WebSocket upgrade on `/ws/room/<uuid>` succeeds.

### 4.7 Site image fixes

The current `Dockerfile` calls `wasm-pack` that isn't installed in
`rust:slim`, and copies `assets` before the WASM builds finish. It is reworked
so that a clean `docker build` works: install `wasm-pack` and the
`wasm32-unknown-unknown` target, build the three WASM crates, then build the
server, and copy `assets` + `templates` (Askama compiles templates in, so only
`assets` is needed at runtime). The pong client's hard-coded
`ws://0.0.0.0:8080/ws` becomes derived from `location` (`wss:` on HTTPS), so it
works behind Caddy. The `site` service is also given a healthcheck route
`/healthz`.

## 5. Annotations (storage-less, URL-encoded)

### 5.1 Scope on the page

The CV content is wrapped in `<main id="cv">`. Only selections fully inside
`#cv` can be annotated. The nav, buttons and the notes panel are outside it.

### 5.2 Data model

```js
// One note
{
  id: "n_<8 chars>",            // random, unique per note
  q: { exact, prefix, suffix }, // text-quote selector, prefix/suffix ≤ 32 chars
  t: "note text",               // ≤ 500 chars, plain text
  a: "author",                  // optional, ≤ 40 chars
  c: 1761650000,                // created, unix seconds
  u: 1761650000                 // updated, unix seconds (merge order)
}
// Document state
{ v: 1, notes: [Note, ...] }    // at most 50 notes
```

### 5.3 URL encoding (`codec.js`)

- Fragment format: `#n=1.<payload>` and, in a room, `#room=<uuid>&n=1.<payload>`.
- `payload = base64url(deflate-raw(UTF-8(JSON(state))))` using the browser's
  `CompressionStream`. The leading `1.` is the format version.
- Decode failures (bad base64, bad deflate, bad JSON, schema mismatch, unknown
  version) return an empty state and show a non-blocking message
  "These notes could not be read." The page never breaks.
- Schema validation drops fields with wrong types and clamps lengths, so a
  hand-crafted URL cannot inject anything.
- Size budget: if the encoded fragment exceeds 8,000 characters the UI refuses
  new notes and says the link is full. (Practical limit of chat apps and
  browsers; a full 50-note state with 500-char notes compresses well below
  typical cases.)
- The URL is updated with `history.replaceState` (no history spam); a
  `hashchange` from outside (user pastes a link) reloads state.

### 5.4 Anchoring (`anchor.js`)

- `describe(range, root)` → `{exact, prefix, suffix}` from the text content of
  `root`, collected with a `TreeWalker` over text nodes. Whitespace is
  normalised (runs collapsed to one space) both when describing and resolving,
  so template reformatting does not break anchors.
- `resolve(selector, root)` → `Range | null`: find all occurrences of `exact`;
  pick the one whose surrounding text best matches `prefix`/`suffix` (score =
  matching chars of prefix from the end + matching chars of suffix from the
  start); ties take the first. No occurrence → `null`.
- Notes whose anchor does not resolve stay in the state and are listed as
  "Text no longer on the page" with their quoted text, so nothing is silently
  lost.

### 5.5 Painting (`highlight.js`)

- CSS Custom Highlight API: one `Highlight` named `notes` for all resolved
  ranges, one named `notes-active` for the focused note, and in rooms one
  highlight per peer colour (`peer-0…peer-7`).
- Clicking highlighted text opens its note: hit test with
  `document.caretPositionFromPoint` (fallback `caretRangeFromPoint`) and
  `range.isPointInRange`.
- Browsers without the Highlight API still get the notes panel and the
  "jump to text" action (it selects the range); only painting is skipped.

### 5.6 UI (`ui.js`)

- On selection end inside `#cv`, a small floating **Add note** button appears
  next to the selection (keyboard: `n`).
- The note editor is a small popover: textarea, optional name (remembered in
  `localStorage`, wrapped in try/catch), Save / Cancel / Delete.
- A **Notes** panel (collapsible, right side on wide screens, bottom sheet on
  phones) lists notes in document order with their quote; clicking one
  scrolls to and flashes the text.
- Toolbar: **Copy link** (copies `location.href`, falls back to a selectable
  input), **Start live session** (§6), **Clear notes** (with confirm).
- All note text is rendered with `textContent`; no HTML from the URL ever
  reaches `innerHTML`.
- Touch: uses `selectionchange` with a short debounce, since mobile browsers
  don't fire `mouseup` reliably after selection handles move.

### 5.7 Modules

`assets/annotate/` — `codec.js`, `anchor.js`, `state.js` (in-memory store,
merge, URL sync), `highlight.js`, `ui.js`, `room.js` (§6), `main.js` (wires
them). Each module is pure where possible (`codec`, `anchor`, `state` have no
UI) so they are unit-testable. The `epic/v2` prototype files
(`app.js`, `highlight.js`, `range.js`, `selection.js`) are replaced by these.

## 6. Live collaboration (rooms)

### 6.1 Flow

1. **Start live session** creates `room = crypto.randomUUID()` and adds
   `room=<uuid>` to the fragment. The URL now invites others.
2. Opening a URL with `room=` connects to `wss://<host>/ws/room/<uuid>`.
3. On connect the client sends `hello`; any peer replies with `state` (its
   full note list). Everyone merges.
4. Each local change sends `upsert` or `remove`; peers merge and repaint.
5. Each participant's URL keeps carrying the full current state, so any URL
   copied from the room still works on its own after the room is gone.
6. **Leave session** removes `room=` and closes the socket; notes stay.

### 6.2 Merge rules (`state.js`)

- Notes keyed by `id`. For the same id, the larger `u` wins; ties broken by
  comparing the serialised note, so all peers converge.
- Deletion is a tombstone `{id, deleted: true, u}` kept in memory for the
  session (so a late `state` does not resurrect it) but not encoded into the
  URL.

### 6.3 Messages (JSON text frames)

```
→ {type:"hello", peer, name?}
→ {type:"state", peer, notes:[…]}
→ {type:"upsert", peer, note}
→ {type:"remove", peer, id, u}
← {type:"presence", peers:[{peer, name?, colour}]}   (sent by server)
```

`peer` is a per-tab `crypto.randomUUID()`. The server relays every client
message unchanged to the other members of the same room (not back to the
sender), after checking it is valid JSON with a known `type`.

### 6.4 Server (`src/rooms.rs`)

- Route `GET /ws/room/:id`; `id` must parse as a UUID, otherwise 400.
- `Rooms = Arc<Mutex<HashMap<Uuid, Room>>>` in `AppState`; a `Room` holds a
  `tokio::sync::broadcast::Sender` and its member list (peer id, name, colour
  index).
- Limits: frames ≤ 64 KB (axum `max_message_size`), ≤ 16 members per room
  (17th gets close code 1013 "room full"), ≤ 30 messages/second per
  connection (excess dropped), ≤ 1,000 rooms in total.
- Room is removed when its last member leaves. Nothing is persisted; a server
  restart ends live sessions but loses no notes, since they are in every URL.
- Ping every 30 s; a connection without a pong for 60 s is closed.
- The existing echo `/ws` used by pong stays as is.

### 6.5 Client resilience (`room.js`)

- Reconnect with backoff (1, 2, 4, 8, max 15 s) and re-send `hello` +
  `state` after reconnecting.
- A status chip shows: Live · n people / Reconnecting… / Offline (notes still
  saved in link).

## 7. Testing

- **Rust**: unit tests for room bookkeeping (join/leave/limits/cleanup);
  integration test that starts the router on an ephemeral port and connects
  real WebSocket clients (`tokio-tungstenite`): relay within a room, isolation
  between rooms, invalid id → 400, room-full close code, malformed messages
  dropped.
- **JS unit** (`node --test`, no extra deps): `codec` round-trip, unicode,
  corrupt inputs, size limit; `state` merge convergence and tombstones;
  `anchor` resolution against a small DOM provided by Playwright in the e2e
  suite (Node has no DOM).
- **E2E** (Playwright, against `cargo run`): select → add note → URL changes →
  open URL in new context → highlight and note visible; corrupted fragment
  shows message; two contexts in one room see each other's notes; leave
  session keeps notes.
- **Stack**: `docker compose config` validation; a local run of the stack with
  `TLS_MODE=internal` (Caddy's self-signed CA) checks routing, oauth2-proxy
  redirect for the admin domain, skip-auth routes reaching Dossier, and WS
  upgrade through Caddy (`deploy/scripts/check.sh`).
- **CI** (`.github/workflows/main.yml`): add `cargo test`, `node --test`,
  Playwright e2e and a `docker build` of the site image.

## 8. Delivery order

1. Merge `epic/v2`; fix the site Dockerfile and pong WS URL; add `/healthz`.
2. Deploy stack (`deploy/`): compose, Caddy, oauth2-proxy, Dossier, db,
   cloudflared profile, scripts, README; validate locally.
3. Annotation client (§5) with unit + e2e tests.
4. Rooms server and client (§6) with tests.
5. CI updates; final end-to-end run of the stack.
6. Deploy to the host Mustafa picks (separate, on request).
