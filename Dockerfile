FROM rust:slim as builder
WORKDIR /app
COPY . .
RUN \
  --mount=type=cache,target=/app/target/ \
  --mount=type=cache,target=/usr/local/cargo/registry/ \
  cargo build --release && \
  cp ./target/release/mskasal / 

WORKDIR /app/ocr
RUN wasm-pack build --target web;cp -r ./pkg/* ../assets 
WORKDIR /app/led_matrix
RUN wasm-pack build --target web;cp -r ./pkg/* ../assets 
WORKDIR /app/pong
RUN wasm-pack build --target web;cp -r ./pkg/* ../assets 

WORKDIR /app
FROM debian:bookworm-slim AS final
RUN adduser \
  --disabled-password \
  --gecos "" \
  --home "/nonexistent" \
  --shell "/sbin/nologin" \
  --no-create-home \
  --uid "10001" \
  mskasal 

COPY --from=builder /mskasal /usr/local/bin
COPY --from=builder /app/assets /usr/local/bin/assets
RUN chown mskasal /usr/local/bin/mskasal
COPY --from=builder /app/assets /opt/mskasal/assets
RUN chown -R mskasal /opt/mskasal
USER mskasal 
ENV RUST_LOG="mskasal=debug,info"
WORKDIR /opt/mskasal
ENTRYPOINT ["mskasal"]
EXPOSE 8080/tcp
