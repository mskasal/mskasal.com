# syntax=docker/dockerfile:1

# ── Build: WASM experiments, then the server ────────────────────────────────
FROM rust:1-slim-bookworm AS builder
WORKDIR /app

# An extra CA for builds behind a TLS-inspecting proxy, if one is passed as
# the build secret `extra_ca`; plain builds skip it.
RUN --mount=type=secret,id=extra_ca,required=false \
  if [ -f /run/secrets/extra_ca ]; then \
    awk '/BEGIN CERT/{n++} {print > ("/usr/local/share/ca-certificates/extra_ca_" n ".crt")}' /run/secrets/extra_ca \
    && update-ca-certificates; \
  fi \
  && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
  && { (apt-get update && apt-get install -y --no-install-recommends binaryen) \
       || echo "binaryen unavailable: WASM is built without wasm-opt"; } \
  && rm -rf /var/lib/apt/lists/*
ENV CARGO_HTTP_CAINFO=/etc/ssl/certs/ca-certificates.crt

RUN rustup target add wasm32-unknown-unknown
RUN --mount=type=cache,target=/usr/local/cargo/registry/ \
  cargo install wasm-pack --locked --version 0.13.1

COPY . .

# wasm-pack's own optimizer download is turned off in each crate; Debian's
# binaryen optimizes instead, when apt could install it.
RUN --mount=type=cache,target=/app/target/ \
  --mount=type=cache,target=/usr/local/cargo/registry/ \
  for crate in ocr led_matrix pong; do \
    (cd "$crate" && wasm-pack build --release --target web \
      && { ! command -v wasm-opt >/dev/null || wasm-opt -Oz -o "pkg/${crate}_bg.wasm" "pkg/${crate}_bg.wasm"; } \
      && rm -f pkg/.gitignore pkg/package.json pkg/README.md \
      && cp -r pkg/* ../assets/) || exit 1; \
  done

RUN --mount=type=cache,target=/app/target/ \
  --mount=type=cache,target=/usr/local/cargo/registry/ \
  cargo build --release --bin mskasal \
  && cp ./target/release/mskasal /mskasal

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS final
RUN adduser \
  --disabled-password \
  --gecos "" \
  --home "/nonexistent" \
  --shell "/sbin/nologin" \
  --no-create-home \
  --uid "10001" \
  mskasal

COPY --from=builder /mskasal /usr/local/bin/mskasal
COPY --from=builder --chown=mskasal /app/assets /opt/mskasal/assets
USER mskasal
ENV RUST_LOG="mskasal=info,tower_http=info"
WORKDIR /opt/mskasal
EXPOSE 8080/tcp
ENTRYPOINT ["mskasal"]
