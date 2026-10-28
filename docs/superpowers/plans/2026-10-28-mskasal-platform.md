# mskasal.com Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-hostable Docker Compose stack with the CV site (with URL-encoded annotations and live rooms) and a Google-protected Dossier back office.

**Architecture:** The Rust/Axum site gains a library crate (`src/lib.rs`) that builds the router, a `rooms` module for WebSocket rooms, and a plain-ES-module annotation client in `assets/annotate/`. `deploy/` holds one Compose stack: Caddy in front, `site`, `oauth2-proxy` → `dossier` + `db`, optional `cloudflared`.

**Tech Stack:** Rust (axum 0.7, askama 0.12, tokio, uuid, tokio-tungstenite for tests), vanilla JS (CompressionStream, CSS Custom Highlight API), Node 22 `node:test`, Playwright, Docker Compose, Caddy 2, oauth2-proxy, Dossier v1.9.2, Postgres 18.

**Spec:** `docs/superpowers/specs/2026-10-28-mskasal-platform-design.md`

## Global Constraints

- Fragment format: `#n=1.<payload>`, in a room `#room=<uuid>&n=1.<payload>`; payload = base64url(deflate-raw(UTF-8(JSON))).
- Limits: 50 notes, note text ≤ 500 chars, author ≤ 40 chars, prefix/suffix ≤ 32 chars, encoded fragment ≤ 8,000 chars.
- Note shape: `{id:"n_<8 chars>", q:{exact,prefix,suffix}, t, a?, c, u}`; state `{v:1, notes:[…]}`.
- Rooms: `GET /ws/room/:id` (UUID, else 400); ≤ 16 members (17th closed with code 1013), ≤ 30 msgs/s per connection, frames ≤ 64 KB, ≤ 1,000 rooms, ping 30 s / drop after 60 s silent.
- Message types: `hello`, `state`, `upsert`, `remove` (client→relay), `presence` (server→clients).
- Peer colours: 8 (`peer-0` … `peer-7`).
- Never put URL-derived text into `innerHTML`.
- Wrap every `localStorage` access in try/catch.
- Dossier pinned to `v1.9.2`; all other images pinned to exact versions.
- Allowed admin email: from `ALLOWED_EMAIL` (Mustafa's: `mustafasamedkasal@gmail.com`).
- Public CV shows e-mail but no phone number.
- Commits end with the session's Co-Authored-By / Claude-Session trailer lines.

## Review Focus

1. Overlapping notes (a new selection covering part of an existing highlight) → both stay listed and painted; clicking the overlap opens the most recently updated note. Test in Task 7.
2. The same text appearing several times on the CV (e.g. "React") → the note re-anchors to the occurrence that was selected, not the first. Test in Task 6.
3. A room link opened while the server is unreachable → notes from the fragment still show; status chip reads "Offline". Test in Task 9.
4. A link truncated by a chat app, or from a future format (`2.…`) → "These notes could not be read." and the page works. Test in Task 4.
5. A selection that starts in the nav and ends in the CV → no Add note button. Test in Task 7.

---

### Task 1: Site baseline — merge epic/v2, library crate, healthz, Dockerfile, pong WS URL

**Files:**
- Merge: `origin/epic/v2` into `ccr-bcf48c96-7e2p5y`
- Modify: `templates/index.html` (remove the phone number `+491743663955 •`; keep the e-mail; wrap CV sections in `<main id="cv">…</main>`; remove `app.js` script/modulepreload)
- Delete: `assets/app.js`, `assets/highlight.js`, `assets/range.js`, `assets/selection.js` (prototype, replaced in Tasks 4–7); `::highlight(my-persistent)` rule in `assets/styles.css`
- Create: `src/lib.rs` (`pub fn router() -> Router`, all templates/handlers moved from `main.rs`), `src/main.rs` becomes: tracing init, `mskasal::router()`, bind `0.0.0.0:${PORT:-8080}`
- Modify: `pong/src/lib.rs:421` — WS URL from `window.location` (`wss:` when protocol is `https:`), path `/ws`; rebuild `assets/pong*` with `wasm-pack build --release --target web`
- Modify: `Dockerfile`
- Modify: `Cargo.toml` (dev-deps: `tokio-tungstenite = "0.21"`, `reqwest = { version = "0.12", default-features = false }`, `futures-util = "0.3"`; deps: `uuid = { version = "1", features = ["v4", "serde"] }`)
- Test: `tests/http.rs`

**Interfaces:**
- Produces: `mskasal::router() -> axum::Router` (state already applied, ready for `into_make_service_with_connect_info::<SocketAddr>()`); `GET /healthz` → 200 `ok`.
- Produces test helper `tests/common/mod.rs`: `pub async fn spawn() -> SocketAddr` (binds `127.0.0.1:0`, serves `router()`, returns the address).

- [ ] **Step 1: Merge** `git merge origin/epic/v2` (resolve nothing expected; branch is ahead of main only).
- [ ] **Step 2: Write failing tests** in `tests/http.rs`: `healthz_returns_ok` (GET `/healthz` → 200, body `ok`); `index_has_cv_root_and_no_phone` (GET `/` → body contains `<main id="cv"` and `mustafasamedkasal@gmail.com`, does not contain `+49174`).
- [ ] **Step 3: Run** `cargo test --test http` → fails to compile (no lib crate).
- [ ] **Step 4: Implement** `src/lib.rs`, slim `main.rs`, `/healthz`, template edits.
- [ ] **Step 5: Run** `cargo test --test http` → PASS.
- [ ] **Step 6: Fix pong WS URL** and rebuild WASM: `cd pong && wasm-pack build --release --target web && cp -r pkg/* ../assets`. (Install `wasm-pack` via `cargo install wasm-pack` and `rustup target add wasm32-unknown-unknown` if missing.)
- [ ] **Step 7: Rewrite Dockerfile**: builder `rust:1-slim-bookworm` + `pkg-config`, `curl`; `rustup target add wasm32-unknown-unknown`; install wasm-pack (prebuilt installer); build `ocr`, `led_matrix`, `pong` into `assets/`; `cargo build --release --bin mskasal`; final `debian:bookworm-slim` with `/opt/mskasal/assets`, user `10001`, `EXPOSE 8080`, `HEALTHCHECK` none (compose does it).
- [ ] **Step 8: Verify** `docker build -t mskasal-site . && docker run --rm -d -p 18080:8080 --name s mskasal-site && sleep 2 && curl -fsS localhost:18080/healthz && docker rm -f s` → prints `ok`.
- [ ] **Step 9: Commit** `feat(site): merge v2 CV, add healthz, lib crate, buildable Dockerfile`.

### Task 2: Deploy stack — compose, Caddy, oauth2-proxy, Dossier, tunnel, README

**Files:**
- Create: `deploy/compose.yml`, `deploy/compose.arm64.yml`, `deploy/Caddyfile`, `deploy/.env.example`, `deploy/scripts/init-env.sh`, `deploy/scripts/check.sh`, `deploy/README.md`, `deploy/.gitignore` (`.env`, `backups/`)

**Interfaces:**
- Produces `.env` variables (exact names): `PUBLIC_DOMAIN`, `ADMIN_DOMAIN`, `TLS_MODE` (`acme|tunnel|internal`), `ACME_EMAIL`, `ALLOWED_EMAIL`, `POSTGRES_PASSWORD`, `DOSSIER_VERSION` (default `v1.9.2`), `DOSSIER_PASSWORD`, `DOSSIER_SECRET`, `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`, `OAUTH2_PROXY_COOKIE_SECRET`, `TZ` (default `Europe/Berlin`), `DOSSIER_AI_PROVIDER` (default `anthropic`), `DOSSIER_AI_MODEL` (default `claude-sonnet-5-5`), `DOSSIER_AI_KEY`, `DOSSIER_JOBS_SOURCE`, `DOSSIER_JSEARCH_KEY`, `DOSSIER_ADZUNA_APP_ID`, `DOSSIER_ADZUNA_KEY`, `DOSSIER_GOOGLE_CLIENT_ID`, `DOSSIER_GOOGLE_CLIENT_SECRET`, `CLOUDFLARE_TUNNEL_TOKEN`, `CADDY_SCHEME` (derived).
- Produces `deploy/scripts/check.sh <public-url> <admin-url> [--insecure]` exiting non-zero on the first failed check.

- [ ] **Step 1: Write `check.sh` first** (it is the test). Checks, each printing `ok …`/`FAIL …`:
  1. `GET <public>/healthz` → 200.
  2. `GET <admin>/` → 302/403 with `Location` containing `/oauth2/` or `accounts.google.com` (never a Dossier page).
  3. `GET <admin>/.well-known/oauth-protected-resource` → response not from oauth2-proxy (no `/oauth2/sign_in` redirect; Dossier answers 200 or 404).
  4. `GET <admin>/api/health` → 200.
  5. WebSocket upgrade `GET <public>/ws/room/<uuid>` with `Connection: Upgrade` headers → 101 (skipped with a note until Task 8 lands; enable then).
- [ ] **Step 2: Write `compose.yml`** per spec §4.1: services `caddy` (`caddy:2.10.2`), `site` (build `..`, healthcheck `/healthz`), `oauth2-proxy` (`quay.io/oauth2-proxy/oauth2-proxy:v7.12.0`), `dossier` (`ghcr.io/aientech/dossier:${DOSSIER_VERSION:-v1.9.2}`, env from Dossier's `compose.production.yml` plus `DOSSIER_PUBLIC_URL=https://${ADMIN_DOMAIN}`, `mem_limit: 1g`, volume `dossier-data:/data`), `db` (`postgres:18-alpine`, healthcheck `pg_isready`), `cloudflared` (`cloudflare/cloudflared:2025.10.0`, `profiles: [tunnel]`, `tunnel run --token`). Only `caddy` publishes `80`/`443`; tunnel users simply don't forward them on their router.
- [ ] **Step 3: oauth2-proxy flags** (env form `OAUTH2_PROXY_*`): `PROVIDER=google`, `UPSTREAMS=http://dossier:3000`, `HTTP_ADDRESS=0.0.0.0:4180`, `REVERSE_PROXY=true`, `EMAIL_DOMAINS=*` + `AUTHENTICATED_EMAILS_FILE=/etc/oauth2-proxy/emails` (bind-mount of `deploy/emails.txt`, written by `init-env.sh` from `ALLOWED_EMAIL`; the image is distroless so it cannot generate it itself), `COOKIE_SECURE=true` (all modes serve HTTPS to the browser), `COOKIE_DOMAINS=${ADMIN_DOMAIN}`, `REDIRECT_URL=https://${ADMIN_DOMAIN}/oauth2/callback`, `SKIP_AUTH_ROUTES=^/api/mcp,^/api/oauth,^/\.well-known/oauth-,^/api/health`, `SKIP_PROVIDER_BUTTON=true`.
- [ ] **Step 4: Caddyfile**: a global `{ email {$ACME_EMAIL} }`; site blocks `{$CADDY_SCHEME}{$PUBLIC_DOMAIN}` → `reverse_proxy site:8080` and `{$CADDY_SCHEME}{$ADMIN_DOMAIN}` → `reverse_proxy oauth2-proxy:4180`, both with `encode zstd gzip` and `import tls_{$TLS_MODE}`; snippets `(tls_acme)` empty, `(tls_internal)` = `tls internal`, `(tls_tunnel)` empty. `CADDY_SCHEME` is `http://` when `TLS_MODE=tunnel` (cloudflared terminates TLS) and `https://` otherwise; `init-env.sh` writes it into `.env` from `TLS_MODE`.
- [ ] **Step 5: `compose.arm64.yml`** overrides `dossier` with `build: { context: https://github.com/AienTech/dossier.git#${DOSSIER_VERSION:-v1.9.2}, target: production }` and `image: dossier-local:${DOSSIER_VERSION:-v1.9.2}`.
- [ ] **Step 6: `init-env.sh`**: copies `.env.example` → `.env` if absent; fills `POSTGRES_PASSWORD` (`openssl rand -hex 24`), `DOSSIER_SECRET` (`openssl rand -base64 32`), `OAUTH2_PROXY_COOKIE_SECRET` (`openssl rand -base64 32 | tr -- '+/' '-_'`, 32 bytes); prompts for the Dossier password via `docker run --rm -it ghcr.io/aientech/dossier:$DOSSIER_VERSION hash-password` and writes `DOSSIER_PASSWORD`; writes `emails.txt`; never overwrites an existing non-empty value.
- [ ] **Step 7: Validate** `cd deploy && cp .env.example .env.test && docker compose --env-file .env.test config -q` → exit 0. Also with `-f compose.yml -f compose.arm64.yml` and `--profile tunnel`.
- [ ] **Step 8: Local run** with `TLS_MODE=internal`, `PUBLIC_DOMAIN=site.localhost`, `ADMIN_DOMAIN=admin.localhost`, dummy OAuth client values: `docker compose up -d --build`, wait for health, then `scripts/check.sh https://site.localhost https://admin.localhost --insecure` (curl `--resolve` to 127.0.0.1) → checks 1–4 `ok`.
- [ ] **Step 9: README** (`deploy/README.md`): prerequisites; `init-env.sh`; Google Cloud OAuth setup (two redirect URIs: `/oauth2/callback`, `/api/google/callback`); Claude: API key path and Claude connector path; hosting recipes (home + Cloudflare Tunnel, VPS with DNS A records, arm64 override); upgrade; backup/restore (Task 3); troubleshooting (`docker compose logs <svc>`).
- [ ] **Step 10: Commit** `feat(deploy): compose stack with caddy, oauth2-proxy and dossier`.

### Task 3: Backup and restore scripts

**Files:**
- Create: `deploy/scripts/backup.sh`, `deploy/scripts/restore.sh`

**Interfaces:**
- `backup.sh` → writes `deploy/backups/<YYYYmmdd-HHMMSS>/{dossier.sql.gz,dossier-data.tar.gz}`, prints the directory.
- `restore.sh <backup-dir>` → stops `dossier`, restores db (`psql` from the dump into an emptied `dossier` database) and `/data`, starts `dossier`. Asks `y/N` before doing anything.

- [ ] **Step 1: Write both scripts** (`set -euo pipefail`; use `docker compose exec -T db pg_dump -U dossier dossier | gzip`; `/data` via `docker compose run --rm -v "$PWD/backups/…:/backup" --entrypoint tar dossier …`).
- [ ] **Step 2: Verify** on the Task 2 local stack: create a profile name in Dossier via `docker compose exec db psql -U dossier -c "select count(*) from \"Profile\""` (record count), run `backup.sh`, `docker compose down -v`, `up -d`, `restore.sh <dir>` answering `y`, re-run the count → same number.
- [ ] **Step 3: Commit** `feat(deploy): backup and restore scripts`.

### Task 4: Annotation codec

**Files:**
- Create: `package.json` (root; `"private": true`, `"type": "module"`, scripts `test:unit`: `node --test tests/unit/`, `test:e2e`: `playwright test`; devDependency `@playwright/test` pinned to the installed Playwright's version)
- Create: `assets/annotate/codec.js`
- Test: `tests/unit/codec.test.js`

**Interfaces:**
- Produces (`codec.js`):
  - `export const LIMITS = { notes: 50, text: 500, author: 40, affix: 32, fragment: 8000 }`
  - `export function sanitizeState(input: unknown) -> { v: 1, notes: Note[] }` — drops non-objects, wrong types, unknown fields; clamps strings to LIMITS; keeps first 50 notes; requires `id` matching `/^n_[A-Za-z0-9_-]{8}$/`, non-empty `q.exact`, numeric `c`/`u`.
  - `export async function encodeState(state) -> string` — returns `"1." + base64url(...)`.
  - `export async function decodeState(payload: string) -> { state, error: null | "unreadable" }` — never throws; on any failure returns `{ state: {v:1, notes:[]}, error: "unreadable" }`.
  - `export function parseFragment(hash: string) -> { room: string|null, n: string|null }` — accepts with or without leading `#`; `room` only if it is a UUID.
  - `export function buildFragment({ room, n }) -> string` — `#room=…&n=…`, omits empty parts, returns `""` when both empty.

- [ ] **Step 1: Write failing tests**: `round_trips_unicode` (note text `"Çok iyi 👍 — ü"` survives encode/decode); `payload_has_version_prefix` (`startsWith("1.")`); `rejects_future_version` (`"2.abc"` → error `unreadable`); `rejects_truncated_payload` (encode, drop last 10 chars → `unreadable`); `rejects_garbage` (`"1.!!!"`, `""`, `"1."` → `unreadable`); `sanitize_clamps_and_drops` (600-char text → 500; author 60 → 40; prefix 50 → last 32 chars; suffix 50 → first 32; a note with `t: 5` dropped; 60 notes → 50; extra field `x` removed); `parse_fragment_ignores_bad_room` (`#room=abc&n=1.x` → room `null`, n `1.x`); `build_fragment_round_trips`.
- [ ] **Step 2: Run** `npm run test:unit` → FAIL (module missing).
- [ ] **Step 3: Implement** with `CompressionStream("deflate-raw")`/`DecompressionStream` via `new Response(blob.stream().pipeThrough(...))`; base64url by hand over `Uint8Array` (no Buffer, so it runs in browsers).
- [ ] **Step 4: Run** `npm run test:unit` → PASS.
- [ ] **Step 5: Commit** `feat(annotate): URL fragment codec`.

### Task 5: Annotation state store and merge

**Files:**
- Create: `assets/annotate/state.js`
- Test: `tests/unit/state.test.js`

**Interfaces:**
- Consumes: `sanitizeState`, `LIMITS` from `codec.js`.
- Produces (`state.js`):
  - `export function newNoteId() -> string` (`"n_" + 8 chars` from `crypto.getRandomValues`, alphabet `A-Za-z0-9_-`).
  - `export function mergeNote(a, b) -> Note` — larger `u` wins; tie → the one whose `JSON.stringify` is lexicographically larger.
  - `export function createStore() -> Store` where `Store` has: `notes(): Note[]` (live notes sorted by `c` then `id`), `get(id)`, `upsert(note) -> boolean` (false when at 50 notes and id is new), `remove(id, u = now) `, `merge(notes: Note[])`, `applyRemote(msg)` (handles `{type:"upsert"|"remove"|"state"}`), `load(state)`, `toState() -> {v:1, notes}`, `subscribe(fn) -> unsubscribe` (fn called after every change with `{ source: "local"|"remote"|"load" }`).
  - Tombstones: `remove` stores `{id, deleted:true, u}`; a merge of an older note with that id is ignored; a newer one revives it. Tombstones are not in `toState()`.

- [ ] **Step 1: Write failing tests**: `merge_is_commutative` (for 20 random pairs `mergeNote(a,b)` deep-equals `mergeNote(b,a)`); `newer_update_wins`; `tombstone_blocks_older_state` (remove at u=10, merge note u=5 → absent); `newer_note_revives_tombstone` (u=11 → present); `upsert_refuses_51st_note`; `toState_excludes_tombstones`; `subscribe_reports_source`; `three_peers_converge` (three stores exchange the same messages in different orders → equal `toState()`).
- [ ] **Step 2: Run** `npm run test:unit` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(annotate): note store with convergent merge`.

### Task 6: Text-quote anchoring

**Files:**
- Create: `assets/annotate/anchor.js`
- Create: `playwright.config.js` (`webServer: { command: "cargo run --bin mskasal", url: "http://127.0.0.1:8080/healthz", reuseExistingServer: true, timeout: 300_000 }`, `use.baseURL: "http://127.0.0.1:8080"`, `testDir: "tests/e2e"`)
- Fixture approach (no fixture files): tests `page.goto("/healthz")` and `page.setContent` with `<script type="module">import * as A from "/assets/annotate/anchor.js"; window.A = A;</script>` (same origin, so the import resolves).
- Test: `tests/e2e/anchor.spec.js`

**Interfaces:**
- Produces (`anchor.js`):
  - `export function textIndex(root: Node) -> { text: string, map: Array<{ node: Text, start: number, end: number, raw: number[] }> }` — whitespace-normalised text of `root` (runs of whitespace → one space) with a mapping back to DOM positions.
  - `export function describe(range: Range, root: Element) -> { exact, prefix, suffix } | null` — null when the range is collapsed or not fully inside `root`; prefix = up to 32 normalised chars before, suffix = up to 32 after.
  - `export function resolve(quote, root: Element) -> Range | null` — scoring per spec §5.4.

- [ ] **Step 1: Write failing tests** in `anchor.spec.js` (each sets content `<main id="cv">…</main>` and calls `window.A`):
  - `describe_then_resolve_round_trips` (select "Rust" inside a sentence → resolve returns a range whose `toString()` is "Rust" at the same offset).
  - `picks_selected_occurrence` (content `<p>React at A.</p><p>React at B.</p>`; describe the second "React"; resolve → range's `startContainer` is inside the second `<p>`). (Review Focus 2)
  - `survives_whitespace_changes` (describe on `"senior   engineer"`, then rewrite DOM to `"senior\n  engineer"` → resolves).
  - `spans_elements` (selection from inside `<b>` to inside following `<i>` round-trips).
  - `returns_null_when_text_gone`.
  - `describe_rejects_range_outside_root` (range starting in a `<nav>` sibling → `null`). (Review Focus 5, unit level)
- [ ] **Step 2: Run** `npx playwright test tests/e2e/anchor.spec.js` → FAIL.
- [ ] **Step 3: Implement** (walk with `document.createTreeWalker(root, NodeFilter.SHOW_TEXT)`; search all occurrences with `indexOf` loop; score; map normalised offsets back through `map`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(annotate): text-quote anchoring`.

### Task 7: Highlights, notes UI and page wiring

**Files:**
- Create: `assets/annotate/highlight.js`, `assets/annotate/ui.js`, `assets/annotate/main.js`, `assets/annotate/annotate.css`
- Modify: `templates/index.html` (include `annotate.css`; `<script type="module" src="/assets/annotate/main.js">`; container `<div id="annotate-root"></div>` after `</main>`)
- Test: `tests/e2e/annotate.spec.js`

**Interfaces:**
- Consumes: `codec.js`, `state.js`, `anchor.js` as defined above.
- Produces (`highlight.js`):
  - `export const supported: boolean` (`"highlights" in CSS`).
  - `export function paint(entries: Array<{ id, range, peer?: number }>, activeId?: string)` — sets highlights `notes`, `notes-active`, `peer-0`…`peer-7`.
  - `export function hitTest(x, y, entries) -> string | null` — among entries containing the point, returns the id with the largest `u` (entries carry `u`). (Review Focus 1)
- Produces (`ui.js`): `export function mountUI({ root: Element, cv: Element, store, onShare, onStartRoom, onLeaveRoom }) -> { setRoomStatus(status: "live"|"reconnecting"|"offline"|null, people?: number), showMessage(text: string) }`.
- Produces (`main.js`): boots everything; owns URL sync: on store change with source ≠ `load`, `encodeState` → if fragment > `LIMITS.fragment` revert the change and `showMessage("This link is full. Remove a note to add another.")`; else `history.replaceState(null, "", buildFragment({ room, n }))`. On `hashchange` → decode and `store.load`. Exposes `window.__annotate = { store }` only when `location.search` contains `debug` (tests use it).
- DOM hooks for tests (exact): Add note button `[data-test=add-note]`; editor textarea `[data-test=note-text]`, name input `[data-test=note-author]`, save `[data-test=note-save]`, delete `[data-test=note-delete]`; panel items `[data-test=note-item]`; orphan items carry `data-orphan`; copy link `[data-test=copy-link]`; start room `[data-test=start-room]`; leave room `[data-test=leave-room]`; status chip `[data-test=room-status]`; message `[data-test=message]`.
- Copy: "Add note", "Notes", "Copy link", "Start live session", "Leave session", "Clear notes", "Text no longer on the page", "These notes could not be read.", "This link is full. Remove a note to add another.", status "Live · {n} people" / "Reconnecting…" / "Offline (notes still saved in link)".

- [ ] **Step 1: Write failing e2e tests** in `annotate.spec.js`:
  - `add_note_updates_url_and_survives_reload` (select the first "Rust" in `#cv` via `page.evaluate` setting a Range; click add-note; type "Nice"; save → `page.url()` contains `#n=1.`; open that URL in a new context → one note-item with "Nice"; `CSS.highlights.get("notes").size === 1`).
  - `no_add_button_for_selection_from_nav` (range from nav link text into first CV paragraph → add-note hidden). (Review Focus 5)
  - `corrupt_fragment_shows_message` (`/#n=1.AAAA` and `/#n=2.x` → message "These notes could not be read.", CV text visible, no notes). (Review Focus 4)
  - `orphan_note_listed` (craft state with `exact: "not on this page"` → item has `data-orphan` and "Text no longer on the page").
  - `overlapping_notes_click_opens_newest` (two notes over overlapping ranges, second newer; click the overlap point → editor shows the second note's text). (Review Focus 1)
  - `note_text_is_not_html` (note text `<img src=x onerror=window.pwned=1>` → `window.pwned` undefined, text shown literally).
  - `delete_note_updates_url`.
  - `full_link_refuses_new_note` (preload 50 notes → adding shows "This link is full…" or the 51st refusal; URL unchanged).
- [ ] **Step 2: Run** `npx playwright test tests/e2e/annotate.spec.js` → FAIL.
- [ ] **Step 3: Implement** `highlight.js`, `ui.js`, `main.js`, CSS (panel right side ≥ 900px wide, bottom sheet below; `::highlight(notes)` yellow, `::highlight(notes-active)` orange, `peer-0..7` distinct hues).
- [ ] **Step 4: Run** → PASS; also run `npm run test:unit` → PASS.
- [ ] **Step 5: Manual check** with `cargo run`: select, note, copy link, open in another browser profile; phone width (375px) panel is a bottom sheet with no horizontal scroll.
- [ ] **Step 6: Commit** `feat(annotate): highlights, notes panel and URL sync`.

### Task 8: Rooms server

**Files:**
- Create: `src/rooms.rs`
- Modify: `src/lib.rs` (add `Rooms` to state, route `/ws/room/:id`)
- Test: `tests/rooms.rs` (uses `tests/common/mod.rs::spawn`)

**Interfaces:**
- Produces (`src/rooms.rs`):
  - `pub const MAX_MEMBERS: usize = 16; pub const MAX_ROOMS: usize = 1000; pub const MAX_MSGS_PER_SEC: u32 = 30; pub const MAX_FRAME: usize = 64 * 1024; pub const PING_EVERY: Duration = 30s; pub const IDLE_TIMEOUT: Duration = 60s;`
  - `#[derive(Clone, Default)] pub struct Rooms(Arc<Mutex<HashMap<Uuid, Room>>>)` with `pub fn join(&self, id: Uuid, peer: Uuid) -> Result<(broadcast::Sender<Relay>, usize /*colour*/), JoinError>` (`JoinError::Full | TooManyRooms`), `pub fn leave(&self, id: Uuid, peer: Uuid)` (drops empty rooms), `pub fn presence(&self, id: Uuid) -> Vec<PeerInfo>`, `pub fn room_count(&self) -> usize`.
  - `Relay { from: Uuid /*connection id*/, text: String }`; colour = lowest unused index in `0..8`, wrapping (`members % 8`) if all used.
  - `pub async fn room_ws(Path(id): Path<String>, State(rooms): State<Rooms>, ws: WebSocketUpgrade) -> Response` — 400 on bad UUID; on join error accept then close with code 1013 and reason `room full` / `too many rooms`.
  - Validation of client frames: text only, ≤ `MAX_FRAME`, JSON object with `type` in `hello|state|upsert|remove`; `name` from `hello` (≤ 40 chars) stored for presence. Invalid frames dropped silently.
  - Server sends `{"type":"presence","peers":[{"peer":"<uuid>","name":…,"colour":n}]}` to the whole room on every join/leave/hello. `peer` is the client's `peer` from its `hello` (connection id until then).

- [ ] **Step 1: Write failing tests** in `tests/rooms.rs`: `relays_to_others_not_sender`; `rooms_are_isolated`; `bad_room_id_is_400` (plain HTTP GET with upgrade headers on `/ws/room/nope` → 400); `seventeenth_member_closed_1013`; `malformed_frames_dropped` (send `"x"`, `{"type":"evil"}`; then a valid `upsert` → peer receives only the valid one); `presence_on_join_and_leave` (counts 1 → 2 → 1); `empty_room_removed` (unit test on `Rooms`: join, leave → `room_count() == 0`); `rate_limit_drops_excess` (send 100 frames instantly → receiver gets ≤ 31 within 500 ms).
- [ ] **Step 2: Run** `cargo test --test rooms` → FAIL.
- [ ] **Step 3: Implement** (per connection: split socket; task A reads client frames → validate → rate-limit with a 1-second window counter → `tx.send(Relay)`; task B reads `rx`, skips own `from`, writes; ping interval; `leave` on exit).
- [ ] **Step 4: Run** `cargo test` → PASS (all Rust tests).
- [ ] **Step 5: Enable** check 5 in `deploy/scripts/check.sh`.
- [ ] **Step 6: Commit** `feat(rooms): websocket rooms with presence and limits`.

### Task 9: Rooms client

**Files:**
- Create: `assets/annotate/room.js`
- Modify: `assets/annotate/main.js` (start/leave session; wire store ⇄ room), `assets/annotate/highlight.js` usage (peer colours: notes remember the colour of the peer that last upserted them, in memory only)
- Test: `tests/e2e/room.spec.js`

**Interfaces:**
- Consumes: `Store.applyRemote`, `Store.subscribe`, `mountUI().setRoomStatus`, `parseFragment`/`buildFragment`.
- Produces (`room.js`): `export function connectRoom({ roomId, peer, name, url = defaultUrl(roomId), onMessage, onStatus }) -> { send(msg: object), close() }`; `defaultUrl(roomId)` = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/room/${roomId}`; reconnect backoff `[1000, 2000, 4000, 8000, 15000]` ms (stays at 15000); after every (re)connect sends `hello` then `state`; `onStatus("live"|"reconnecting"|"offline", peopleCount)`; goes `offline` after the first failed attempt that never connected and keeps retrying.
- Wiring: local store changes (`source: "local"`) → `upsert`/`remove` messages; incoming `hello` from another peer → reply with `state`; incoming `state`/`upsert`/`remove` → `store.applyRemote`; `presence` → status chip count and peer colours.

- [ ] **Step 1: Write failing e2e tests**: `two_contexts_see_each_others_notes` (A starts session; B opens A's URL; A adds note → B sees note-item within 1 s; B adds note → A sees it; both status chips "Live · 2 people"); `late_joiner_gets_state` (A adds 2 notes, then B joins → B has 2); `delete_propagates`; `leave_keeps_notes` (A leaves → URL has no `room=`, notes still there); `offline_room_link_still_shows_notes` (`page.routeWebSocket("**/ws/room/**", ws => ws.close())`, Playwright ≥ 1.48, then open a room link with notes → notes visible, chip "Offline (notes still saved in link)"). (Review Focus 3)
- [ ] **Step 2: Run** `npx playwright test tests/e2e/room.spec.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx playwright test` and `cargo test` → PASS.
- [ ] **Step 5: Commit** `feat(annotate): live sessions over websocket rooms`.

### Task 10: CI

**Files:**
- Modify: `.github/workflows/main.yml`

- [ ] **Step 1: Restructure** into jobs on `push` (all branches) and `pull_request`: `rust` (`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`); `js` (`npm ci`, `npm run test:unit`, `npx playwright install --with-deps chromium`, `npm run test:e2e`); `docker` (`docker build .`; `cd deploy && cp .env.example .env && docker compose config -q`). Use `actions/checkout@v4`, `dtolnay/rust-toolchain@stable` (replaces the deprecated `actions-rs/toolchain`), `actions/setup-node@v4` (node 22), `Swatinem/rust-cache@v2`. Drop the old "move assets" steps (Docker does it now).
- [ ] **Step 2: Verify locally** that each job's commands pass (`cargo fmt --check && cargo clippy -- -D warnings && cargo test && npm run test:unit && npx playwright test`); push and confirm the workflow is green on the PR.
- [ ] **Step 3: Commit** `ci: test rust, js and docker builds`.

### Task 11: Final end-to-end verification

- [ ] **Step 1:** `cd deploy && docker compose up -d --build` with `TLS_MODE=internal` test env; `scripts/check.sh https://site.localhost https://admin.localhost --insecure` → all 5 `ok`.
- [ ] **Step 2:** Playwright against the stack (`BASE_URL=https://site.localhost`, `ignoreHTTPSErrors`) runs `annotate.spec.js` and `room.spec.js` → PASS (proves WS through Caddy).
- [ ] **Step 3:** `docker compose down -v`; update `deploy/README.md` with anything learned; commit `docs(deploy): notes from end-to-end run`.
- [ ] **Step 4:** Hand-off to Mustafa: list of what they must provide for the real deploy (domain DNS access, Google OAuth client, Anthropic API key, host choice).
