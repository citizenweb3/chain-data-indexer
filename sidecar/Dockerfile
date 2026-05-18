# syntax=docker/dockerfile:1
# Stage 1: build
FROM rust:1.92-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY Cargo.toml ./
# Pre-fetch dependencies using a stub main (layer-cache friendly)
RUN mkdir -p src && echo 'fn main(){}' > src/main.rs && \
    cargo fetch && \
    cargo build --release 2>/dev/null; \
    rm -rf src

COPY src ./src
# Touch to force rebuild of our code (not deps)
RUN touch src/main.rs src/decode.rs && cargo build --release

# Stage 2: minimal runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/miden-decoder /usr/local/bin/miden-decoder

ENV DECODER_PORT=4000 \
    RUST_LOG=miden_decoder=info

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/miden-decoder"]
